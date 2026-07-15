/**
 * AI 客户端 - 精简版
 * 从 src/lib/ai-client.ts 提取，保留核心 chatCompletion 功能
 * 去除 Next.js / Prisma 依赖，API Key 直接从 config 读取
 */

import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.js';

// ==================== 类型定义 ====================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  timeout?: number;
}

export interface ChatCompletionResponse {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ==================== 配置解析 ====================

function getPrimaryConfig() {
  return {
    apiKey: config.ai.apiKey,
    baseUrl: config.ai.baseUrl,
    model: config.ai.model,
  };
}

function getFallbackConfig() {
  return {
    apiKey: config.ai.openRouterApiKey,
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    model: config.ai.openRouterModel,
  };
}

// ==================== SSE 解析 ====================

function parseSSEResponse(sseText: string, fallbackModel: string): ChatCompletionResponse {
  let fullContent = '';
  let model = fallbackModel;
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  for (const line of sseText.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (data === '[DONE]') continue;

    try {
      const parsed = JSON.parse(data);
      if (parsed.model) model = parsed.model;
      if (parsed.usage) {
        usage = {
          promptTokens: parsed.usage.prompt_tokens || 0,
          completionTokens: parsed.usage.completion_tokens || 0,
          totalTokens: parsed.usage.total_tokens || 0,
        };
      }
      const delta = parsed.choices?.[0]?.delta;
      if (delta?.content) fullContent += delta.content;
    } catch {
      /* skip malformed chunks */
    }
  }

  return { content: fullContent, model, usage };
}

// ==================== curl 执行器 ====================

function execCurl(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('curl', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGTERM');
        reject(new Error(`curl timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
          stderr: Buffer.concat(stderrChunks).toString('utf-8'),
          exitCode: code ?? 1,
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(new Error(`curl spawn error: ${err.message}`));
      }
    });
  });
}

// ==================== 调用实现 ====================

async function callViaCurl(
  apiKey: string,
  baseUrl: string,
  messages: ChatMessage[],
  model: string,
  options: ChatCompletionOptions
): Promise<ChatCompletionResponse> {
  const { temperature = 0.3, maxTokens = 4096, topP = 0.8, timeout = 300 } = options;

  const requestBody = JSON.stringify({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    top_p: topP,
    stream: true,
  });

  const ts = Date.now();
  const tmpFile = join(tmpdir(), `ailead-${ts}-${Math.random().toString(36).slice(2, 8)}.json`);
  writeFileSync(tmpFile, requestBody, 'utf-8');

  console.log(`[ai-client] curl+stream, model=${model}, maxTokens=${maxTokens}`);

  try {
    const result = await execCurl([
      '-s', '-S',
      '--max-time', String(timeout),
      '-X', 'POST',
      baseUrl,
      '-H', 'Content-Type: application/json',
      '-H', `Authorization: Bearer ${apiKey}`,
      '--data-binary', `@${tmpFile}`,
    ], (timeout + 10) * 1000);

    if (result.exitCode !== 0) {
      throw new Error(`curl failed (exit ${result.exitCode}): ${result.stderr || 'unknown'}`);
    }

    if (!result.stdout.trim()) {
      throw new Error(`curl returned empty response. stderr: ${result.stderr}`);
    }

    const response = parseSSEResponse(result.stdout, model);

    if (!response.content) {
      try {
        const errorData = JSON.parse(result.stdout);
        if (errorData.error) {
          throw new Error(`API error: ${JSON.stringify(errorData.error)}`);
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('API')) throw e;
      }
      throw new Error('API returned empty content');
    }

    console.log(`[ai-client] done: ${response.content.length} chars, model=${response.model}, ${Date.now() - ts}ms`);
    return response;
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

async function callViaFetch(
  apiKey: string,
  baseUrl: string,
  messages: ChatMessage[],
  model: string,
  options: ChatCompletionOptions
): Promise<ChatCompletionResponse> {
  const { temperature = 0.3, maxTokens = 4096, topP = 0.8, timeout = 300 } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout * 1000);

  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        top_p: topP,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    }

    const data = await response.json() as {
      model?: string;
      error?: unknown;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    if (data.error) throw new Error(`API error: ${JSON.stringify(data.error)}`);

    const content = data.choices?.[0]?.message?.content || '';
    if (!content) throw new Error('API returned empty content');

    return {
      content,
      model: data.model || model,
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

// ==================== 主入口 ====================

/**
 * 调用 AI 模型 - 主 Coding Plan，失败自动切换 OpenRouter
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {}
): Promise<ChatCompletionResponse> {
  const primary = getPrimaryConfig();

  if (!primary.apiKey) {
    throw new Error('TEXT_API_KEY is not configured');
  }

  const model = options.model || primary.model;

  try {
    // 优先用 curl（Windows 本地），fallback 用 fetch
    if (process.platform === 'win32') {
      return await callViaCurl(primary.apiKey, primary.baseUrl, messages, model, options);
    }
    return await callViaFetch(primary.apiKey, primary.baseUrl, messages, model, options);
  } catch (primaryError) {
    const errMsg = primaryError instanceof Error ? primaryError.message : String(primaryError);
    console.warn(`[ai-client] Primary failed: ${errMsg.slice(0, 200)}`);

    // 尝试 OpenRouter 备用
    const fallback = getFallbackConfig();
    if (fallback.apiKey) {
      console.log(`[ai-client] Falling back to OpenRouter (${fallback.model})...`);
      try {
        return await callViaFetch(fallback.apiKey, fallback.baseUrl, messages, fallback.model, options);
      } catch (fallbackError) {
        const fbMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        console.error(`[ai-client] OpenRouter fallback also failed: ${fbMsg.slice(0, 200)}`);
      }
    }

    throw primaryError;
  }
}

// ==================== JSON 解析工具 ====================

/** 清理 AI 返回的 JSON（去除 markdown 代码块等） */
export function stripJsonFences(content: string): string {
  let result = content.trim();
  result = result.replace(/^```(?:json)?\s*\n?/i, '');
  result = result.replace(/\n?```\s*$/i, '');

  const objectStart = result.indexOf('{');
  const arrayStart = result.indexOf('[');

  if (objectStart >= 0 || arrayStart >= 0) {
    const jsonStart = objectStart >= 0 && arrayStart >= 0
      ? Math.min(objectStart, arrayStart)
      : Math.max(objectStart, arrayStart);

    if (jsonStart > 0) {
      const jsonContent = result.slice(jsonStart);
      if (jsonContent.trim().startsWith('{') || jsonContent.trim().startsWith('[')) {
        result = jsonContent;
      }
    }
  }

  return result.trim();
}

/** 安全解析 AI 返回的 JSON，失败时尝试修复 */
export async function parseAIJson<T = Record<string, unknown>>(content: string): Promise<T> {
  const cleaned = stripJsonFences(content);

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // 尝试用 AI 修复 JSON
    try {
      const repaired = await chatCompletion([
        {
          role: 'system',
          content: '你是一个 JSON 修复器。请把用户提供的内容整理成严格合法的 JSON，不要输出 markdown、代码块、解释或额外文字。',
        },
        {
          role: 'user',
          content: `请将下面内容修复为严格 JSON，只输出 JSON：\n\n${cleaned.slice(0, 12000)}`,
        },
      ], { temperature: 0, maxTokens: 4096 });

      return JSON.parse(stripJsonFences(repaired.content)) as T;
    } catch {
      throw new Error('AI 返回的内容无法解析为 JSON');
    }
  }
}

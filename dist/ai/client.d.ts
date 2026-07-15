/**
 * AI 客户端 - 精简版
 * 从 src/lib/ai-client.ts 提取，保留核心 chatCompletion 功能
 * 去除 Next.js / Prisma 依赖，API Key 直接从 config 读取
 */
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
/**
 * 调用 AI 模型 - 主 Coding Plan，失败自动切换 OpenRouter
 */
export declare function chatCompletion(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<ChatCompletionResponse>;
/** 清理 AI 返回的 JSON（去除 markdown 代码块等） */
export declare function stripJsonFences(content: string): string;
/** 安全解析 AI 返回的 JSON，失败时尝试修复 */
export declare function parseAIJson<T = Record<string, unknown>>(content: string): Promise<T>;

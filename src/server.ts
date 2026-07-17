/**
 * Express 服务器入口
 * 挂载 API 路由 + 静态 UI 文件
 */

import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { initDb } from './db.js';
import { initSchema } from './schema.js';
import { scanRouter } from './api/scan.js';
import { enrichRouter } from './api/enrich.js';
import { pipelineRouter } from './api/pipeline.js';
import { configRouter } from './api/config.js';
import { resourcesRouter } from './api/resources.js';
import { publicScanRouter } from './api/public-scan.js';
import { apiKeyAuth } from './api/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function startServer() {
  // 初始化数据库
  await initDb();
  initSchema();

  const app = express();

  // 中间件
  app.use(cors({
    origin: config.service.corsOrigins.length ? config.service.corsOrigins : true,
  }));
  app.use(express.json({ limit: '10mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // Public liveness endpoint. It contains no provider or credential details.
  app.get('/api/health', (_req, res) => {
    const payload: Record<string, unknown> = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      authRequired: Boolean(config.service.apiKey),
    };
    // Local test UI prefill only (EXPOSE_API_KEY_IN_UI=true). Do not enable on public hosts.
    if (config.service.exposeApiKeyInUi && config.service.apiKey) {
      payload.apiKey = config.service.apiKey;
    }
    res.json(payload);
  });

  // All business and configuration APIs are protected when SERVICE_API_KEY is set.
  app.use('/api', apiKeyAuth);

  // API 路由
  app.use('/api/scan', scanRouter);
  app.use('/api/public/scan', publicScanRouter);
  app.use('/api/enrich', enrichRouter);
  app.use('/api/pipeline', pipelineRouter);
  app.use('/api/config', configRouter);
  app.use('/api/resources', resourcesRouter);

  // JSON 404 for unmatched /api/* (avoid HTML DOCTYPE confusing clients)
  app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
  });

  // 静态 UI：优先源码 ui（tsx / 开发），其次 dist/ui
  const sourceUi = join(__dirname, '..', 'src', 'ui');
  const compiledUi = join(__dirname, 'ui');
  const uiRoot = existsSync(join(sourceUi, 'index.html'))
    ? sourceUi
    : compiledUi;
  app.use(express.static(uiRoot));

  // JSON body / 未捕获错误 → 统一 JSON，避免 HTML DOCTYPE
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const status =
      typeof err === 'object' && err && 'status' in err && typeof (err as { status: unknown }).status === 'number'
        ? (err as { status: number }).status
        : typeof err === 'object' && err && 'statusCode' in err && typeof (err as { statusCode: unknown }).statusCode === 'number'
          ? (err as { statusCode: number }).statusCode
          : 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: message,
      code: status === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR',
    });
  });

  app.listen(config.port, () => {
    console.log(`\n🚀 AI Lead Gen server running at http://localhost:${config.port}`);
    console.log(`   UI: http://localhost:${config.port}/`);
    console.log(`   API: http://localhost:${config.port}/api/health\n`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

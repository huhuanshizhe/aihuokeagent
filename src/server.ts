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
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      authRequired: Boolean(config.service.apiKey),
    });
  });

  // All business and configuration APIs are protected when SERVICE_API_KEY is set.
  app.use('/api', apiKeyAuth);

  // API 路由
  app.use('/api/scan', scanRouter);
  app.use('/api/enrich', enrichRouter);
  app.use('/api/pipeline', pipelineRouter);
  app.use('/api/config', configRouter);
  app.use('/api/resources', resourcesRouter);

  // 静态 UI 文件
  const compiledUi = join(__dirname, 'ui');
  const sourceUi = join(__dirname, '..', 'src', 'ui');
  app.use(express.static(existsSync(compiledUi) ? compiledUi : sourceUi));

  // 启动服务
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

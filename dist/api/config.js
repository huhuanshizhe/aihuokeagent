/**
 * Config API 路由
 * GET /api/config - 获取当前适配器配置
 */
import { Router } from 'express';
import { getAdapterStatus, config } from '../config.js';
import { getAllAdapterCodes } from '../adapters/registry.js';
export const configRouter = Router();
// GET /api/config - 获取配置状态
configRouter.get('/', (_req, res) => {
    try {
        const adapterStatus = getAdapterStatus();
        const availableAdapters = getAllAdapterCodes();
        res.json({
            success: true,
            data: {
                server: {
                    port: config.port,
                },
                adapters: adapterStatus,
                availableAdapters,
                ai: {
                    model: config.ai.model,
                    configured: !!config.ai.apiKey,
                },
            },
        });
    }
    catch (error) {
        console.error('[api/config] Error:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
//# sourceMappingURL=config.js.map
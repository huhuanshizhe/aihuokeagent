import type { NextFunction, Request, Response } from 'express';
export declare function extractRequestApiKey(authorization?: string, headerKey?: string): string | undefined;
export declare function apiKeyAuth(req: Request, res: Response, next: NextFunction): void;

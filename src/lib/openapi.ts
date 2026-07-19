/**
 * OpenAPI spec loader — YAML contract is the source of truth (vexmotor-admin style).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { config } from '../config.js';

export type OpenApiSpec = Record<string, unknown>;

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveSpecPath(): string {
  const candidates = [
    join(process.cwd(), 'docs', 'openapi.public.yaml'),
    join(process.cwd(), 'dist', 'docs', 'openapi.public.yaml'),
    join(__dirname, '..', 'docs', 'openapi.public.yaml'), // dist/lib → dist/docs ; src/lib → docs
    join(__dirname, '..', '..', 'docs', 'openapi.public.yaml'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  throw new Error(
    `OpenAPI spec not found. Tried:\n${candidates.map((p) => `  - ${p}`).join('\n')}`,
  );
}

function resolveServerUrl(): string {
  const fromEnv =
    process.env.PUBLIC_BASE_URL?.trim()
    || process.env.SERVICE_PUBLIC_URL?.trim()
    || process.env.AUTH_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return `http://localhost:${config.port}`;
}

export function getOpenApiSpec(): OpenApiSpec {
  const raw = readFileSync(resolveSpecPath(), 'utf8');
  const base = parseYaml(raw) as OpenApiSpec;
  const serverUrl = resolveServerUrl();
  const yamlServers = Array.isArray(base.servers)
    ? (base.servers as Array<{ url: string; description?: string }>)
    : [];

  return {
    ...base,
    servers: [
      { url: serverUrl, description: 'Current environment' },
      ...yamlServers.filter((item) => item.url !== serverUrl),
    ],
  };
}

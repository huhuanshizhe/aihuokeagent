# Deployment and API consumption

Pushing this directory to Git distributes the source code. A callable API additionally requires a running host with a public HTTPS URL.

## Required production architecture

- Neon PostgreSQL via Drizzle; set `DATABASE_URL` before starting the service.
- A persistent volume mounted at `/app/data`.
- HTTPS termination at the hosting platform or reverse proxy.
- `SERVICE_API_KEY` set to a long random secret.
- Provider credentials supplied as host-managed environment variables, never committed to Git.

## Docker deployment

```bash
docker build -t vertax-ai-lead-gen .
docker run -d \
  --name vertax-ai-lead-gen \
  -p 3100:3100 \
  -v ai-lead-gen-data:/app/data \
  --env-file .env \
  vertax-ai-lead-gen
```

The public liveness endpoint does not require authentication:

```bash
curl https://lead-api.example.com/api/health
```

All other `/api/*` endpoints require either header form:

```http
Authorization: Bearer <SERVICE_API_KEY>
```

or:

```http
X-API-Key: <SERVICE_API_KEY>
```

## Offline software: complete acquisition flow

The offline client can call the closed-loop endpoint directly:

```bash
curl -X POST https://lead-api.example.com/api/pipeline/run \
  -H "Authorization: Bearer $SERVICE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "industry": "pet hospital",
    "keywords": ["pet hospital"],
    "countries": ["MY"],
    "maxResults": 20,
    "enrichTopN": 10,
    "enrichmentConcurrency": 3,
    "skipDecisionMakers": true
  }'
```

Alternatively call the stages independently:

- `POST /api/scan`
- `GET /api/scan/results?runId=...`
- `POST /api/enrich`
- `GET /api/enrich/results?candidateId=...`

Use standard enrichment for interactive/batch calls. Deep enrichment can exceed one minute and should move to asynchronous jobs before high-volume production use.

## Environment variables

Required for public deployment:

- `SERVICE_API_KEY`
- At least one discovery provider (`GOOGLE_MAPS_API_KEY`, `BRAVE_SEARCH_API_KEY`, or supported official registry)
- Provider keys needed by the selected enrichment depth

Recommended:

- `DASHSCOPE_API_KEY`
- `HUNTER_API_KEY`
- `EXA_API_KEY`
- `FIRECRAWL_API_KEY`
- `CORS_ORIGINS` when a browser frontend calls the API

See `.env.example` for the full list.

## Hosting choice

A Docker-capable VPS or serverless host with Neon is the current target. Multi-replica deployment is fine against shared Postgres. Deep enrichment should still move to a durable job queue before high concurrency production use.

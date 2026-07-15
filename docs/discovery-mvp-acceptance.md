# Discovery MVP acceptance baseline

Status: **frozen for the discovery-to-enrichment handoff**
Accepted: 2026-07-15

## Stable scope

- Inputs: target countries, industry, one or more customer-profile keywords, exclusions, and result limit.
- Planning: compose a versioned market pack and industry pack, then select active sources automatically.
- Retrieval: run independent providers concurrently, with provider-level failure isolation.
- Cost control: execute at most six online queries per provider and reduce that budget for small result requests.
- Quality: normalize, cross-source deduplicate, qualify, and separate `qualified`, `review`, and `rejected` records.
- Learning: record anonymous source-run metrics and reuse mature performance evidence in later plans.
- Output: persist candidates and return provenance, diagnostics, per-provider statistics, and the exact `resourcePlan` used.

## Scan response contract

The discovery API returns these stable top-level fields in `data`:

- `runId`
- `resourcePlan`
- `totalFetched`, `totalFound`, `totalNew`
- `totalQualified`, `totalReview`, `totalRejected`, `totalDeferred`
- `adapterResults`
- `errors`, `warnings`, `duration`
- `rejectedSamples`, `reviewSamples`

New diagnostic fields may be added compatibly. Removing or renaming these fields requires an API version change.

## Acceptance evidence

Automated suite: 28/28 passing, including normalization, qualification, deduplication, localization, resource planning, official-registry parsing, bounded work, and query budgets.

Live smoke tests (automatic planning; no adapter override):

| Scenario | Planned/executed sources | Fetched | Found | Qualified | Review | Provider errors |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Thailand · automotive manufacturing | DIW factory, Google Places, Brave Places, AI Search | 21 | 9 | 3 | 6 | 0 |
| Malaysia · pet hospital | Google Places, Brave Places, AI Search | 24 | 7 | 5 | 2 | 0 |

Counts are smoke-test observations, not fixed product guarantees; external search results naturally change.

## Production backlog (outside the frozen MVP)

- Tenant authentication, authorization, and tenant-scoped API-key storage.
- Durable asynchronous jobs, retry policy, cancellation, idempotency, and webhooks.
- Per-tenant quotas, provider cost accounting, rate limiting, and spend alerts.
- Source licensing/compliance review, retention rules, and deletion workflows.
- Human feedback labels feeding source and qualification quality metrics.
- Scheduled resource-pack freshness checks and approval/version rollback workflow.
- OpenAPI versioning and consumer contract tests before embedding in other products.

Further country and industry coverage should normally be added as resource packs or source definitions, not by changing the scanner core.

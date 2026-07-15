# Enrichment MVP acceptance baseline

Status: **frozen for the discovery-to-enrichment API handoff**
Accepted: 2026-07-15

## Stable scope

- Standalone enrichment by company name/domain and candidate-linked batch enrichment.
- Standard mode for first-party website contacts and configured domain-email sources.
- Deep mode for Exa identity research, Firecrawl, AI profile extraction, and decision makers.
- Field-level provenance, confidence, conflict resolution, information gaps, and recommended channel.
- Candidate write-back for verified website and resulting CRM/contact fields.
- Explicit disk flush before successful scan or enrichment responses.
- Single-process local development to protect the whole-file `sql.js` store.

## Verification evidence

- Automated tests: 33/33 passing.
- Hunter configuration loaded without exposing any key preview.
- Hunter live domain search completed in about 3.8 seconds and added a corporate-domain email.
- Standard live enrichment returned first-party website, email, phone, and source evidence without errors.
- Deep live enrichment completed all six stages: Exa, Hunter, official website, Firecrawl, AI profile, and decision-maker research.
- Deep result: 3 emails, 2 phones, 3 decision makers, 15 evidence records, and no information gaps.
- Search-suggested but unreachable `gasingvet.com` remained evidence only and was not promoted or written back as an official website.
- A scan, candidate, and enrichment were written to disk, the server process was stopped, and all original IDs were readable after a new process started.

External provider latency and result counts are observations, not guarantees. Standard mode remains the default for interactive and batch use.

## Production backlog

- Move long-running deep enrichment to durable asynchronous jobs with callbacks/webhooks.
- Tenant-scoped credentials, encryption at rest, quotas, and audit logs.
- Provider cost accounting and per-stage retry/circuit-breaker policies.
- Email deliverability verification and catch-all/domain-risk classification.
- Phone normalization to E.164 and country-aware validation.
- Human review for identity conflicts and decision-maker confirmation.
- Replace the local single-writer store with a multi-tenant production database.

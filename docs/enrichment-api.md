# Enrichment API

`POST /api/enrich` completes one standalone company or a batch of persisted discovery candidates.

## Request modes

Standalone:

```json
{
  "companyName": "Example Company",
  "domain": "https://example.com",
  "country": "MY",
  "depth": "standard"
}
```

Discovery-linked batch:

```json
{
  "candidateIds": ["candidate-uuid"],
  "depth": "standard",
  "concurrency": 3
}
```

`standard` is the default. It verifies and crawls the supplied official website, extracts first-party contacts, and uses configured domain-email providers. `deep` additionally enables identity search, Firecrawl/AI profiling, and decision-maker research when their providers are configured.

Limits: 50 candidate IDs per request and concurrency from 1 to 8.

## Result contract

Each result contains identity and contact fields plus:

- `fieldEvidence`: field-level value, source, source URL, confidence, and observation time.
- `conflicts`: competing values and the selected resolution.
- `informationGaps`: fields that remain unavailable.
- `recommendedChannel`: `email`, `phone`, `linkedin`, `contact_form`, or `research`.
- `stages`: completed, skipped, or failed status and duration for every provider stage.
- `confidenceScore` and `status`: overall usability summary.

For candidate-linked requests, the best website, email, phone, description, and CRM fields are written back to the candidate record. Provider evidence remains in the enrichment snapshot.

Search-suggested websites are treated as leads only. They must be reachable and match the company identity before being promoted to the verified website or used to persist Hunter-derived contacts.

The built-in website crawler rejects local/private targets, validates DNS results, limits redirects and downloaded HTML, and applies request timeouts.

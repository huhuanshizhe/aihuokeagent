# Discovery Resources

This directory is the version-controlled knowledge layer for discovery planning. Adapter code stays in `src/adapters`; market, industry, source, localization, policy and quality metadata live here.

## Resource types

- `markets/*.json`: country aliases, languages, geographic viewports, clusters, localization phrases and preferred sources.
- `industries/*.json`: reusable entity intent, keywords, exclusions, local terminology, source types and qualification signals.
- `sources/*.json`: coverage, authority, fields, cost, refresh, cache, terms and lifecycle state.

## Source lifecycle

1. Add a source as `research`.
2. Verify authority, terms, access method, schema, refresh behavior, cost and a real sample.
3. Implement and test an adapter when required.
4. Promote to `active` only after the checks pass.
5. Use anonymous run metrics to adjust ranking after at least two comparable runs.
6. Set `disabled` when access, terms or quality no longer meet requirements.

Research sources appear in plans for review but are never placed in `recommendedAdapters`.

## Adding a market

Create a market JSON with a stable country code, semantic version, aliases, languages, a valid viewport, priority clusters, localization phrases and registered source codes. Reload through `POST /api/resources/reload`; no server restart is required.

## Adding an industry

Create an industry JSON with aliases that the planner can detect, neutral English keywords, negative keywords, per-country local terms, preferred source types and explicit qualification signals.

## Multi-tenant boundary

These files and `discovery_source_runs` contain shared public strategy and anonymous performance only. Candidate companies, contacts, ICP rules, feedback and outreach remain tenant-private and must not be copied into shared packs.

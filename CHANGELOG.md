## Unreleased — web UI

Correct report row-limit follow-ups, hide unsupported controls, and reject invalid counts before submission. MCP runtime remains 0.2.4.

## 0.2.0 - 2026-10-22

## 0.2.4

- Bind dictionary metrics to explicit saved SQL tables and columns, then preview, execute and continue with a row-limit follow-up in one workflow. Legacy records are preserved.
- Permit recognized aggregate SQL with internal identity aliases while retaining lineage checks and full-result privacy screening. Unknown sensitive syntax stays blocked.
- Correct stale saved-parameter guidance; source versions, immutable previews, saved date logic and unknown cache freshness remain explicit.

## 0.2.3 — 2026-10-23

Support previewed replay of saved event-date SQL bindings; stale previews and unsupported bindings fail closed. SQL and upstream reports remain unchanged. Temporary argument overrides remain unsupported.

## 0.2.2 — 2026-10-23

Saved SQL adds explicit table/column selection and fixed previews. CTE output aliases become candidates. Unrelated dashboard lookup failures no longer block a visible source; incomplete catalogues fail explicitly. No SQL/date rewrites or upstream report changes. 459 automated tests and 36 standalone checks passed.

## 0.2.1

- Preserve blank/invalid numeric filter drafts instead of silently converting to zero.
- Isolate schedule submission failures so later plans and queued work continue.
- Add unattended multi-step worker, restart, partial failure and export acceptance.


### Features
- Initial public release with 52 MCP tools for Volcengine DataFinder analytics and metric dictionaries.
- Independent SQLite storage, persistent jobs, a separate worker and authenticated local exports.
- Read-only defaults with preview and one-use confirmation for enabled changes.

### Documentation
- Bilingual installation guides, fictional demos, MIT license and MCP Registry metadata.
- Vendor subscriptions and API permissions remain required; no hosted service is included.

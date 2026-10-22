# 0.2.2 acceptance

- 459 automated tests, TypeScript and production build passed.
- All 52 tools remain available. 36 standalone integration checks passed, including new read-only SQL previews, CTE column candidates, projection preserving rows/null/zero, and stale-preview rejection.
- SQL projection chooses exact output column names from one explicitly numbered table; it never rewrites SQL, changes saved dates, filters rows, aggregates values, or infers business metrics. Missing/duplicate selected columns fail explicitly. Privacy checks inspect the whole upstream response before projection.
- An unrelated dashboard failure no longer blocks a visible SQL source. If no source is found and any catalogue page failed, the result remains unknown rather than not-found.
- Local browser checks used fictional data and actual React components. A separate limited real read-only saved-SQL comparison passed. This does not validate every tenant, saved SQL, or upstream analysis option. Parameterized SQL remains blocked.
- New cloud page and native ChatGPT schema availability are separate from standalone MCP acceptance. Existing native tool schemas may need a connector refresh before new SQL fields are available.
- No data deletion, upstream report modification, or production metric import was performed.

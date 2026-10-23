# 0.2.5 acceptance

- 492 public-source regression tests, type checking and production build passed.
- Full 52-tool standalone acceptance passed all 44 checks using an isolated SQLite database.
- Rolling funnel correction was retested with live read-only queries and compared with the vendor console; production page and native MCP returned matching minute/day results.
- Custom frequency and per-user sum buckets matched the console over seven days. This does not establish automatic grouping, association or complete attribution support.
- Public source/package inspection excluded tenant identifiers, private endpoint addresses and real acceptance data.
- npm publication is pending renewed account authentication; Registry submission has not been attempted for this version.

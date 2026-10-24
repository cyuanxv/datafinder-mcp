# 0.2.5 acceptance

- 492 public-source regression tests, type checking and production build passed.
- Full 52-tool standalone acceptance passed all 44 checks using an isolated SQLite database.
- Rolling funnel correction was retested with live read-only queries and compared with the vendor console; production page and native MCP returned matching minute/day results.
- Custom frequency and per-user sum buckets matched the console over seven days. This does not establish automatic grouping, association or complete attribution support.
- Public source/package inspection excluded tenant identifiers, private endpoint addresses and real acceptance data.
- Published to npm on 2026-10-24. The public 0.2.5 package was installed into a fresh directory; all 44 acceptance checks passed with all 52 tools. All 98 installed package files matched the frozen tarball.
- npm integrity matched: `sha512-KIshl2S0VtQMZ/EjCq8zOug8Zk+3R370nNPt6ry+p9KOfjzp6vFlUrRtCFzYyHThXmedMkucxJ4d8Gs+B+y8XQ==`.
- Published `io.github.cyuanxv/datafinder-mcp` 0.2.5 to the official MCP Registry. Publication does not automatically add a connector to ChatGPT.

Public records: [npm](https://www.npmjs.com/package/@cyuanxv/datafinder-mcp/v/0.2.5), [MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.cyuanxv%2Fdatafinder-mcp/versions/0.2.5).

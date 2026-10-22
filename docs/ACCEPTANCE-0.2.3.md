# 0.2.3 acceptance

- 52 MCP tools; saved SQL replays existing event-date bindings without SQL substitution or upstream report writes.
- Fixed previews bind the source, selection, row count and expected Shanghai calendar dates. Missing/unknown/today/reversed/wide bindings, stale previews and response drift fail closed. Temporary overrides are unsupported.
- 469 offline tests, type checking and production build passed. Ten new parameter regressions include midnight boundaries before and during execution.
- Generated package and clean tarball installation: 39 independent checks passed, including foreground disconnect, worker polling, durable restart, failure preservation and export after restart. All fixtures are fictional.
- Private cloud automatic dispatch has separate platform and persisted-job evidence. This is not a physical power-off test. Local npm workers require a running host; cloud workers require a cloud deployment and scheduler.
- Data freshness, actual upstream date evidence and business definitions remain separate from execution acceptance.

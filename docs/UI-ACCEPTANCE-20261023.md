# Query follow-up UI acceptance

- Fixed saved-report row limits: inherit `result_limit` and send that field on follow-up. Preserve source version, metric selection, dates, formulas and filters.
- Hide unsupported limit controls for funnels and fixed-bin distributions. Apply per-analysis maximums; blank/invalid numeric drafts stay visible and are rejected before submission.
- Synthetic browser checks covered formula + OR filters, preview, row-limit-only continuation, isolated save/readback, revalidation and execution. A readback cannot execute until a fresh preview is obtained.
- 492 offline tests, TypeScript and production build passed. Fixtures contain no live tenant data.
- This is a web UI patch; MCP tool definitions and runtime query behavior are unchanged. Published npm/Registry version remains 0.2.4.
- Private-service result checks are documented separately and are not included in public source. No production metric import, data deletion or upstream report modification.

Generated standalone package: all 52 tools and 44 integration checks passed; no npm or Registry publication was needed for this UI-only patch.

The implementation was merged in PR #9 after the GitHub checks passed. Private cloud deployment and the live report follow-up also passed; tenant details remain outside the public repository.

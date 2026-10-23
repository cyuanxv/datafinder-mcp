# 0.2.4 acceptance

- 489 offline tests, TypeScript and production build passed.
- 52 tools / 44 checks passed against both generated package and a fresh tarball installation.
- Synthetic dictionary binding → unified SQL preview → execution → row-limit follow-up passed through MCP transport. Default read-only mode, one-use confirmation, owner isolation, persistent jobs and exports remain covered.
- Sensitive internal SQL aliases are allowed only when the recognized final outputs are safe; direct/renamed identifiers, unknown sensitive syntax, stars, CTE column renames and unselected private results stay blocked.
- Live private-service checks compared three saved reports with original read-only responses; the complex report also matched all seven output columns. No tenant data or identifiers are included here.
- No production metric imports or upstream report modifications were performed.

Private cloud deployment and native MCP preview/execution/follow-up passed; publication readback is recorded after release.

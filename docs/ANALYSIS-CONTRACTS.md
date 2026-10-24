# Verified analysis boundaries

Rolling ordered-user funnels use the documented `window_period` and `window_period_type` fields. A legacy `window_type: 1` override was removed: it could make different durations behave alike. Minute, hour and day requests were retested; minute and day results were compared with the vendor console. Existing stored definitions are preserved, but corrected counts can differ. Windows remain limited to seven days; immature windows are rejected.

Custom event-frequency bins and custom per-user summed-property bins were compared bucket by bucket over seven days. User bins use left-open, right-closed intervals; zero belongs to `(-INF,0]`. Only event-triggering users are counted. This does not validate default automatic grouping, quick groups, negative amounts, missing values or every possible boundary dataset.

Association properties and the complete attribution configuration remain unverified. The product describes five attribution models, but this adapter currently supports first, last and linear attribution. It does not guess undocumented fields for time decay, position weighting, property attribution, process-event association, other conversions or model comparison.

The vendor has confirmed that dashboard, report and native metric creation/editing APIs are unavailable and currently unplanned. Browser operation in the vendor console is a separate, explicitly authorized workflow.

All acceptance queries were read-only. No saved upstream reports or production metrics were changed. This document contains no tenant identifiers or production result data.

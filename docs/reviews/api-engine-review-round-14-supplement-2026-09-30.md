# Round 14 supplemental integrated-source observations — 2026-09-30

These are integration-owner acceptance probes after the six main Sol6/xhigh R14 findings were repaired, not another xs review and not a zero-findings round. The separate module-contract Sol6 report adds one supported cross-format P2; its mixed-copy exclusion was corrected using the explicit existing compatibility contract.

## R14-E02A — P2 — Persistent root-native facade cannot be detached as its native type

Actual current TypeScript, Bun 1.4.2, React server rendering: create a root `Map([['id',1]])` with an own hidden `{self: map}` field; construct `Carburetor(map)`; a class declares `view=this.connect(store)` and `selection=this.connectSelection(store,()=>this.view)`, then renders the selected Map's value. `detachOpaque` calls the facade's `forEach` with a facade receiver and throws `TypeError: Map operation called on non-Map object`. A live-escape diagnostic fires before the failure even though an ordinary Map is supposed to be copied safely. This is a real public connected-root path, not an arbitrary external Proxy.

Acceptance: exact native Map/Set/Date facades detach from the current owned target, preserving native contents, own descriptors, self/cross aliases and source isolation. Retargeting after whole-state replacement must not use a stale static target; snapshot reads must retain the native root's wildcard subscription. Opaque custom-instance facades remain live and retain their genuine unsafe-child diagnostic.

## R14-E02B — P2 — Own accessor shadowing native dispatch executes before rejection

Actual current TypeScript probe adds an own accessor at `forEach` on ordinary Map/Set or `getTime` on Date. Each getter increments a counter and returns a function. The copier eventually rejects the accessor, but all three counters are **1**, not 0: native contents are copied by dispatching through the value's own property before descriptor checking.

Acceptance: copy native contents through the correct intrinsic and owned raw receiver, without evaluating own method shadows. Every own accessor must be rejected with getter count 0. Own data descriptors shadowing native method names must survive while the underlying native contents still copy correctly; preserve the existing graph memo and subclass boundary.

## Other observed closure evidence

- Integrated R14 focused verification: **75/75 in 8 files**; typecheck, lint with zero errors, 7-entry/600-line/one-export layout and four runtime build formats plus declarations passed. Two overlong new test titles were shortened, not their behavior assertions.
- Actual Chromium mounted cache: an older answer after pending invalidation rendered `success:true:true:old` with loader call 2 already started; the later answer rendered `success:false:false:new`, still call 2. Suspense-only invalidated Success retained `old` during refresh and rendered `new` after its next parent render. No publication occurred while the fixture's readers were rendering; browser errors were empty.
- Fresh built CJS store → ESM persistent class and hook selectors, both graph traversal orders: both rendered `<p>answer</p>`, detached key mutation left raw key id 1, and no false `connectSelection()` escape warning appeared. Expected duplicate-module diagnostics remained visible. This closes the separately reported same-version module identity path; the packed consumer regression and native-facade refinements remain independently tracked.

All product changes remain uncommitted. This report does not assert final full-suite success, packed-matrix completion or a zero xs round.

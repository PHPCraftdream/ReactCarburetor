# Round 13 — supplemental acceptance observations (2026-09-30)

These are integration-owner runtime observations, not an additional xs review or a replacement for the two Sol6 xhigh reports. The API and engine reports review frozen snapshot `d68d133c131e3de2c5197f515b64bf3d61fe466beaef2a289b900fa84599267d` and establish five P2 findings. The three cases below were found while accepting the HS repairs against current TypeScript in `cycle-integration`, based on report-only HEAD `18173f2`; source changes remained uncommitted. The observations occurred at successive intermediate repair states, not one claimed frozen snapshot.

**Supplemental findings: P0=0, P1=0, P2=2, P3=1.** All have actual execution evidence. Fixes were made in the same isolated Sol6 high worktrees as their related R13 finding; no source commit, push or version bump was made.

## R13-E02A — P2 — supported array prototypes omitted from kind/clone semantics

After the initial ordinary/null-object repair, `Object.setPrototypeOf([1, 2], null)` was accepted state, but `sameKind` still treated all arrays alike. A computed mapping `rows` when `typeof rows.map === 'function'` kept `"2,4"` after public `setData` installed the null-prototype array. A separate `restore` did not install that prototype. The bounded Bun actual-source output was:

```json
{"rawNull":true,"rawMap":"undefined","computed":"2,4","version":0,"seen":[],"restoredNull":false}
```

HS extended prototype identity to supported arrays and retained supported prototypes in `deepClone`; otherwise snapshot/history would still erase the requested shape. The same consumer after repair produced:

```json
{"rawNull":true,"rawMap":"undefined","computed":"no-map","version":1,"seen":["no-map"],"restoredNull":true}
```

Permanent regressions cover root/nested `setData`/`restore`, reverse transitions, unchanged controls, snapshot and undo/redo. Eight array-boundary regressions failed before this supplemental source repair; all prototype/history tests subsequently passed. Non-index array properties remain invalid state; no input-validation exception was added.

## R13-API-02A — P2 — replacement loses the abort retry guard

The initial cache repairs correctly dropped an obsolete raw rejection and retried Error after invalidation, but abort inferred previous failure from `failures.has(key)`. A replaced or hydrated Error can have no retained raw rejection. Mounted React/JSDOM source sequence: fail request 1, replace the same Error entry, invalidate to start request 2, then abort it. Actual before repair:

```json
{"before":{"dom":"pending:false","calls":2},"after":{"dom":"pending:false","calls":3}}
```

The abort notification immediately started an unwanted third request. Three permanent mounted regressions for `setData`, `restore` and `fromJSON` failed before the request-owned guard repair. HS records failed-start controller ownership in a lazy WeakSet; successful caches allocate no such guard and no per-request wrapper. Replaying the composed source sequence after repair produced:

```json
{"before":{"dom":"pending:false","calls":2},"after":{"dom":"idle:true","calls":2}}
```

A later explicit invalidation can retry and succeed; canceled late answers do not replace that answer and unmount releases the reader. Raw failure identity and retry disarming are now separate concerns.

## R13-E03A — P3 — safe class selections trigger a false live-escape diagnostic

The repaired class copier preserved a tracked plain key and its raw Map key, but the development diagnostic still classified the input read proxy as a live child escape before considering detachment. Both key-first and Map-first class regressions passed their topology assertions and then failed the suite's unexpected-console guard. A bounded source SSR connected-view consumer printed:

```json
{"html":"<div>answer</div>","observed":[{"lookup":"answer","same":true}]}
```

It also reported that this safely copied key was live, which was false. HS corrected classification rather than suppressing console output or disabling diagnostics. The same source consumer now produces the same correct topology with no diagnostic. A real opaque-root facade remains live: its gated child is observably stale after source replacement and the diagnostic still reports it. Obsolete diagnostic-only/wording assertions were removed; nested, array, symbol, hidden-descriptor and topology behavior remains covered.

## Integrated evidence and limits

- After all five R13 repairs and these three refinements, the focused run passed **129/129** tests in **11 files**, with no skipped/todo tests. It includes replacement ownership, prototype/history transitions, aliases and read tracking, cache replacement/retry/abort, and genuine unsafe-escape behavior.
- Actual source smoke also exercised plain Map aliases in both orders, selected-key mutation isolation, root/nested ordinary/null-object history, computed next-publication ownership, and the composed cache abort above.
- Subsequent mechanical TSDoc/test-line/async-act fixes and weak-registry consolidation require the final integrated gates; this report does not claim a final full-suite or final benchmark result. The separate validation report records those once executed.
- Timings and allocated-byte claims are intentionally absent here. The library's final paired benchmarks and real Chromium surfaces are owned by the integration workflow, not these bounded acceptance probes.

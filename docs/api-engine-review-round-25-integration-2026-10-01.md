# Round 25 integration

## Independent verdict and complete correction

Freeze `b8d4a6c`: API and engine each established one P2, independently confirming the same mechanism with slot and cache manifestations; no P0/P1/P3. Reports transferred as `6800071` and `44548d5`. Combined distinct finding count one P2, not a zero round.

Completed hs1 normalization slices were transferred immediately and committed after parent proof:

- `15a1376`: shared prerequisite. Existing strict graph ownership moved to Store/Utils/Graph/cloneOwnedGraph, with a private descriptor transform applied before recursive value copy and descriptor definition. Existing history/classification callers migrated, ordinary deepClone/snapshot behavior unchanged. Actual source smoke transformed readonly Pending→Idle with original input unchanged, exact flags, Map root backlink and plain key/value alias intact.
- `569fdee`: slot owned replay. Writable fields normalize in the existing fresh graph; configurable readonly fields redefine the fresh descriptor in place; non-configurable readonly status changes make one lazy complete graph copy with normalized status and omitted wire key before restriction definition. Native backlinks, caller isolation, settled-key/cancellation guards preserved.
- `1916cca`: cache owned replay. Only actual cache entries normalize; nested payload status/refreshing fields are untouched. Locked field/dictionary changes use one lazy full graph copy; configurable descriptors redefine in place. Newer reentrant live entries keep their current dictionary capabilities and identity, permitting later settlement rather than inheriting a captured readonly slot.
- `1916cca`: history integration. Trust of the exact fresh replay target is separated from replay-publication suppression: an abort-listener publication can end suppression without revoking graph ownership. The callback's new branch remains recorded.
- `89ad8f5`: installed consumers exercise readonly Pending slot, cache Pending, refreshing and combined fields with timestamps, normalized values, readonly flags and native root/entry backlinks.

Cache worker exposed two coupled reentrant boundaries; parent corrected the history identity guard, worker corrected the live dictionary overlay capability and added actual public-request regression. No swallowing errors, no skipped normalization, no ordinary metadata-notification expansion. Configurable descriptors reuse their fresh descriptor object rather than allocating spread copies. Source/test grouping uses coherent Graph, Cache/State and resource History directories. Completed fix worktrees and browser scaffolds removed after proof.

## Observed parent verification

- Typecheck/layout passed after grouping eight-entry source/test directories. Public root symbol names retained; no old helper module shims.
- Final lint passed: no errors, 46 warnings; local scratch exclusion not committed. LSP again missed the excluded test's moved helper import; no code action was available, parent repaired the exact import and reported the tool issue.
- Focused slot/cache/history integrated run: **139/139**, ten files, no skips/todos/snapshot changes, including finite in-flight cancellation/reentrant refresh versus late old answer and retained sibling flags/native aliases.
- Built development/production CJS↔ESM boundary helper: **120** cases.
- Complete suite: **1469/1469**, 136 files, no skips/todos/snapshot changes; 326987 ms reported duration.
- Packed consumer matrix: **16/16**, no skips/failures; React 18/19 npm/pnpm CJS/ESM, strict file-based mixed-format probe, Next 16.3.5 webpack/Turbopack.
- Actual Chromium slot `status|timestamp|writable`: `pending|7|false → idle|none|true → idle|7|false` over admission/undo/redo. Cache `status|refreshing|timestamp`: `success|true|9 → empty → success|false|9`. Alias checks displayed `slot-root:true|cache-root:true|cache-entry:true|readonly:true`. No browser errors; owned tab/server/bundle removed.

## Paired bounded workload observations

Seven samples, copied round-25 baseline versus integrated build:

| Scenario | Baseline median ms | Integrated median ms | Preserved work |
|---|---:|---:|---|
| Ordinary patch history | 0.486 | 0.493 | 128 writes, one capture |
| Resource snapshot history | 27.736 | 28.996 | 64 loads, 128 transitions, 129 captures |
| Populated cache replacement | 0.070 | 0.084 | extra endpoint walks zero both sides |
| Mixed graph capture | 0.176 | 0.248 | original root/row visits one both sides |
| Native alias selection | 0.8664 | 0.5264 | 128 lookups/checksum8128/129 paths; root2/row256 visits both sides |

Ranges overlap; no speedup or allocation-byte claim. An extra complete normalization copy is restricted to immutable changed fields; existing writable/configurable replay keeps its one owned graph path.

## Continuing independent review

Round-26 xs1 API/engine reviews run on identical `89ad8f5` source/runtime freezes, final matrix-built ignored dist copied into both trees. Reviewer reports use the current 2026-10-01 date. Green checks and these closed normalization manifestations do not establish zero combined P0–P3.

# Round 17 integration — 2026-09-30

## Verdict

Independent round-17 API review returned P0/P1/P2/P3 = **0/0/0/0**. Independent engine review returned **0/0/2/2**, so the round was not clean. Both reports were transferred to `master` immediately (`13bc7bc`, `05ac025`). All four findings and the real computed-publication integration regression below are repaired and committed. The next independent review must establish its own counts; these green gates do not imply zero.

## Repairs and main delivery

| Finding | Actual verified result |
|---|---|
| R17-ENGINE-01 | Read/draft Map/Set intrinsic arguments canonicalize trusted tracked keys, members and roots to the original raw graph. Natural `draft.map.set(draft.key,…)` updates the existing key; `watch` and `Computed` read the same value. Receiver/chaining and mixed CJS/ESM aliases are retained. |
| R17-ENGINE-02 | Undo/redo settle collected newer writes before selecting a coherent step. Manual scheduler plain/native pending writes undo `2→1`; a later flush retains redo. An independent recorder's canceled `1→2→1` patch batch cannot insert a phantom `1→1` step; its real undo reaches `0`. |
| R17-ENGINE-03 | Supported equal-content native graphs insert no history step and do not erase valid redo. Comparison checks intrinsic Map/Set/Date contents, own data descriptors, prototypes, holes/symbols and bijective alias/cycle topology without calling accessors. Real in-place changes still reverse. |
| R17-ENGINE-04 | Mixed plain/native capture uses one canonical memo, native intrinsics and descriptor-safe fast plain shapes. It does not abandon a speculative plain prefix and copy it again. Original root/row visits fall from two to one. |
| R17-ENGINE-01A | Computed announcement recognizes canonical underlying native identity behind newly minted facades. An actual in-place Map mutation announces once and advances version even with an always-equal comparator, rather than suppressing the publication as a changed facade reference. |

HS work remained isolated; parent owned main integration and exercised verification. Completed transfers were committed separately as required by the user:

- `a5ca525`: canonical native collection view arguments, tracking tests and public documentation.
- `15748fc`: pending/coherent history, equality and one-pass ownership, functional regressions, 72-case built consumer fixture and mixed capture benchmark.
- `60e4cb8`: canonical computed announcement repair; existing failing consumer regression retained.
- `2126f64`, `ffaa91c`: removed incidental snapshot-call instrumentation and a computed native identity pin. The later raw Map handoff identity pin was also removed in `60e4cb8`; native read/selection and actual DOM publication behavior remain covered. No identity assertion was re-pinned to the new implementation.

An actual parent callback probe found a boundary within the native-key task: `forEach` initially supplied a raw third collection argument, so nested tracked-key lookup missed and the collection differed from the calling facade. The callback adapter now preserves the calling collection facade, thisArg, raw entry values and native TypeError behavior for an invalid callback even on an empty collection. Source proof changed from `match=false,value=undefined` to `match=true,value=7,setMatch=true,rejected=true`; a functional regression was retained.

An actual independent-history probe found the remaining net-zero patch batch after the first pending repair. The changed-path check now compares only touched paths first; only canceled candidates verify the complete authoritative topology. Single ordinary writes and genuinely changed multi-patch batches retain their no-full-capture fast path. Actual probe changed from second undo returning true at unchanged `1` to a real undo reaching `0`.

## Verification observed

- Typecheck passed after each source transfer and computed repair.
- Scoped lint passed with existing warnings retained; the unrelated user-owned `scratch/**` is excluded only from the local command, not changed or hidden by a committed lint policy.
- Layout passed: 7 entries/600 lines/one export.
- Changed-path runtime suite: **109/109** in 6 files before removal of two obsolete instrumentation tests. Native key/read/watch, history, raw/wire cancellation and functional callback behavior passed.
- Computed native mutation/retained tracking suite: **52/52** in 4 files; the real always-equal native mutation publication regression passed.
- Retained computed DOM/live-results suite: **23/23** in 2 files after removing the obsolete live Map identity pin.
- Final full suite: **1371/1371** in 126 files, no skips/todos/failures/snapshot changes; test-run total 317.846 s.
- Packed consumers: **16/16**, no skips/failures: React18/19, npm/pnpm, ESM/CJS, mixed-format selections/history and Next16.3.5 Turbopack/webpack.
- Actual built cross-format consumer: **72** history/resource cases in both module directions, including natural proxy keys/root/Set membership, tracked watch/computed, pending plain/native undo/redo and read-only Map/Set/Date history. Class/hook SSR graph selections also passed.
- Actual mixed CJS store / ESM computed smoke with `{equals:()=>true}`: `notified=1,version=1,value=2` after the native mutation.
- Real Chromium class + hook + computed surface using **natural draft keys**: `1|true|1|1 → 2|true|2|2 → 2|true|2|2` after read-only access, then undo `1|true|1|1`, redo `2|true|2|2`, branch `3|true|3|3`. Replay results `true,true,false`; zero browser errors. Owned browser tab/service stopped; own throwaway scripts removed.

Failures were fixed in the same cycle: sparse literal fixture lint violations were rewritten with real holes, documentation summary was shortened, callback lexical this removed an unnecessary alias, and the real native-facade comparator regression was corrected rather than deleting it. Obsolete raw-identity/implementation assertions were deleted rather than re-pinned; no runtime exception or supported tracking path was suppressed.

## Paired mixed capture measurement

Existing real history driver was extended with a bounded mixed graph capture and original-node reflection counter. Seven alternating measured samples follow two warmups; both distributions are independently built. Baseline is the exact pre-repair round-17 copied distribution (`a594e1c`); fixed is main after the history/key transfers. Reflection counts are **work observations, not byte allocations**; mixed timing includes identical counter instrumentation on both sides and is a local trend, not a CI threshold.

| Scenario | Baseline → fixed median | Work |
|---|---|---|
| Ordinary patch history | 0.553 → 0.559 ms | 128 writes, one complete capture on each side |
| Resource wire history | 31.442 → 33.437 ms | 64 loads/128 transitions, 129 capture calls on each side |
| Mixed plain/native capture | **0.963 → 0.287 ms** | One capture; original root visits **2→1**, representative original row visits **2→1** |

The mixed graph contains 128 actual plain rows, a plain native Map key and a root backlink. After timing/counters, a real native mutation is undone/redone and checked for both key lookup and root alias fidelity. Resource timing is not claimed as an improvement; exact work and correctness checks are retained. Raw observations are the session artifact `r17-history-paired-observations.json`; final visual evidence is `r17-natural-native-key-ui-proof.json`.

No push or package/dependency version bump occurred. `dist/` stays local/generated/Git-ignored and ships via the package allowlist after prepack. User-owned locks, scratch content and plan document were not staged. Next round reviews the final committed source and copied built artifacts in two identical isolated worktrees.

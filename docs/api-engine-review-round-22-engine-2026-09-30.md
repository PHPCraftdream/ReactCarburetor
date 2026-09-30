# Independent API and engine review, round 22 — engine — 2026-09-30

**Target and method.** Inspected the isolated `cycle-review-r22-engine-xs` tree at frozen product revision `3df804e5fa0d5d0ef09aa0afdda035320fb0c87e`. Traced the actual engine, public contract and selected prior engine reviews, then ran bounded public-API probes with Bun 1.4.2 on this tree's TypeScript source and Node 24.12.0 on its supplied packed CJS/ESM distribution. Only this report is changed. No product edit, suite, build, lint, formatter, benchmark or synthetic load was run in this worktree.

**Verdict: P0=0, P1=0, P2=2, P3=0. The engine is not at zero.** The two independent failures are a published state change with an unusable history cursor and an applied draft write that publishes nothing after a patch listener throws. Both reproduce through supported public APIs and the supplied packed CJS output.

| ID | Severity | Consumer-visible failure |
| --- | --- | --- |
| R22-ENG-01 | P2 | Replacing a plain branch containing a supported readonly enumerable field writes and notifies, but its attached history cannot record or undo the change. |
| R22-ENG-02 | P2 | A throwing attached patch observer stops write-path attribution *after* the raw mutation, so `update` returns an error while the changed value is invisible to watchers and `getVersion`. |

## R22-ENG-01 — scalar replacement patches cannot advance a readonly history baseline

**Contract and mechanism.** `README.md:656-675,681-683,917-927` promises history of published operations, including preservation of supported readonly endpoints; ordinary snapshot flags, by contrast, are intentionally normalized. `Store/Tracking/Aliases/AliasLedger.ts:37-51,123-137` accepts enumerable own readonly data fields in initial state. A valid assignment `draft.row = {x: 2}` replaces the *parent* of such a field, which the write proxy accepts and diffs into a scalar `row.x` patch (`Store/Tracking/createWriteProxy.ts:364-412`; `Store/Paths/Diff/diffPaths.ts:85-110,120-141`). History's initial `own()` preserves the readonly descriptor and classifies it (`Tooling/CarburetorHistory.ts:95-120,220-241`). Yet `onPatch()` unconditionally accepts a primitive-only patch without considering whether its path can be installed into that previously owned readonly baseline (`Tooling/CarburetorHistory.ts:364-372`). On publication, `buildEntry()` calls `installPatch(this.baseline, patch, false)` (`Tooling/CarburetorHistory.ts:503-514`); its direct assignment to `row.x` throws (`Store/Paths/Diff/installPatch.ts:18-41`). Publication isolates/logs that exception (`Store/Transaction/PatchObserverRegistry.ts:130-161`, `Store/Carburetor.ts:395-425`), but the history retains pending patches with no past entry; a subsequent `undo()` retries the same failing baseline installation (`Tooling/CarburetorHistory.ts:261-268,426-430`). A non-configurable, writable field removed by a parent replacement similarly leaves an un-installable delete patch; an independently executed source probe returned `undo: "Unable to delete property."` after a valid `draft.row = {}`.

**Bounded source repro** (also repeated with Node against `dist/cjs/Carburetor/index.js`; disable diagnostic printing only to make outputs compact):

```ts
import {Carburetor, CarburetorHistory, diagnostics} from './lib/src/Carburetor/index.ts';
diagnostics.setEnabled(false);
class S extends Carburetor<{row: {x: number}}> {
    edit(change: (draft: {row: {x: number}}) => void) { this.update(change); }
}
const row = {x: 1};
Object.defineProperty(row, 'x', {value: 1, writable: false, enumerable: true, configurable: true});
const s = new S({row});
const h = new CarburetorHistory(s);
const watch: number[] = [];
s.watch(d => d.row.x, next => watch.push(next));
s.edit(d => { d.row = {x: 2}; });
let undo: unknown;
try { undo = h.undo(); } catch (error) { undo = (error as Error).name + ': ' + (error as Error).message; }
console.log({data: s.getData().row.x, version: s.getVersion(), watch, canUndo: h.canUndo(), undo});
```

Observed source: `data:2, version:1, watch:[2], canUndo:false, undo:'TypeError: Attempted to assign to readonly property.'`; packed CJS: `data:2, version:1, canUndo:false, undo:"TypeError:Cannot assign to read only property 'x' of object '#<Object>'"`. Expected `canUndo:true`, then successful undo restoring `x:1` (and retaining the owned readonly endpoint), without throwing or losing the operation. **Remedy:** before admitting a patch fast path, ensure its target path can be applied to the *owned baseline*, including readonly assignments and non-configurable deletions; classify an un-installable patch as an opaque owned endpoint before baseline mutation. Preserve scalar fast paths for ordinary writable paths and do not confuse this value-changing replacement with the explicitly excluded descriptor-only notification claim.

## R22-ENG-02 — observer exception after raw write suppresses its publication

**Contract and mechanism.** `README.md:130-137,833-841,919-927` documents `update()` as the safe draft+publish path and supports independently attached patch observers (`Models/Paths.ts:63-81`). `Carburetor.update()` promises to publish any mutations already applied when its callback throws (`Store/Carburetor.ts:464-481`). The write trap's ordinary scalar path mutates the raw object at `Store/Tracking/createWriteProxy.ts:370-383` but calls `reportPatch(listener, …)` at `:414-416` *before* `record(path)` at `:418`. A consumer-provided `attachPatchListener({patch})` can throw at mutation time. That escapes the draft trap after the raw value has already changed and before the path is recorded; `update()`'s `finally` calls `emitUpdate()`, but its touched-and-empty-writes branch returns without bumping the version or delivering (`Store/Carburetor.ts:556-590`). This is not merely a swallowed observer diagnostic: an ordinary watched value now differs from the live data permanently until a future relevant publication. The same ordering exists around deletion, `defineProperty` and replacement-diff patch callbacks, so merely moving one scalar `record` does not cover every affected trap.

**Bounded source repro** (repeated using Node's supplied packed CJS export):

```ts
import {Carburetor, diagnostics} from './lib/src/Carburetor/index.ts';
diagnostics.setEnabled(false);
class S extends Carburetor<{x: number}> {
    edit() { this.update(d => { d.x = 2; }); }
}
const s = new S({x: 1});
const seen: number[] = [];
s.watch(d => d.x, next => seen.push(next));
s.attachPatchListener({patch() { throw new Error('observer failure'); }});
let thrown: unknown;
try { s.edit(); } catch (error) { thrown = (error as Error).message; }
console.log({thrown, raw: s.getData().x, version: s.getVersion(), seen});
```

Observed source and packed CJS: `thrown:'observer failure', raw:2, version:0, seen:[]`. Expected: even if `edit()` rethrows the observer failure, the already applied value change must publish to the reader, giving `version:1, seen:[2]`, as the `update()` partial-write guarantee requires. **Remedy:** attribute all effective raw mutations before fallible observer delivery, and ensure a patch callback failure cannot abort traversal of other changed paths; preserve observer fanout/exception isolation without silently treating a mutated draft as a no-op. This finding does not request swallowing the observer's own error or adding a new observer API.

## Independent breadth and bounded controls

- **Plain read/write, paths and current ownership.** Traced `Carburetor.read/draft/setData/restore/emitUpdate`, read/write proxy `get/has/ownKeys/getOwnPropertyDescriptor/set/defineProperty/deleteProperty`, per-tree weak branch cache, persistent facade retargeting, escaped paths, branch/key markers, ancestor matching, read transfer, `SubscriberIndex` generations/refiling/extension/removal, `WriteLog` watermark and wildcard fallback. Reviewed native Map/Set receiver facades, canonical arguments, own data and root backlinks, root-scoped native alias ownership index and mutation invalidation. A fresh Bun source control reproduced the former R21 watch and alias scenarios *after* fixes: two successive leaf edits produced detached watch callbacks `[{a:2,b:1},{a:2,b:2}]` and same-content plain replacement followed by Map-alias leaf edit produced callback `[2]`, version `1`. No descriptor-only ordinary value notification is claimed: `README.md:896-904` defines plain state by own enumerable string data values, and ordinary snapshot flag normalization is intentional (`Store/Utils/deepClone.ts:48-65`).
- **Structural arrays, ordering and restore.** Inspected array length conversion/shrink/partially refused tail, implicit length growth, sparse holes, numeric vs ordered string keys, ordered key replay, branch replacement diff threshold, preflight across affected readonly assignments/deletions/locked tails/additions, detached fallback, installPatch and same-kind kind boundaries. One source control deleted the first string key of `{a:1,b:2}`, then undid/redid and restored reordered keys: raw key orders `['b'] → ['a','b'] → ['b'] → ['b','a']`, all four watch notifications as expected. A second sparse `[1,,3]` length-lock control observed `writable:false → true → false` across lock/undo/redo while index `1` stayed a hole. Those controls do not assert exhaustive failure injection or load behavior.
- **Waves, subscribers and computed.** Reviewed `UpdateBatch`, `UpdateWave`, sync/throttle schedule/cancel/reentrant drain, observer publication before ordinary subscribers, computed attachment rollback, native write epoch, flattened leaf versions/path drift, external-source bridges, live read-set extension, snapshot revision, announced-vs-cached baselines and disposal. A bounded source transaction moving two stores from `1+2` to `2+3` announced a subscribed computed exactly once with `[5]`, `get() === 5`, `getVersion() === 1`. Read-set and generation reasoning does not replace a concurrent-render or browser proof.
- **Graph/history/crossmodule.** Inspected owned Map/Set/Date graph cloning, descriptor and alias topology equality, opaque vs patch choice, sparse/order/readonly traits, replay ownership and failure cursor, clear/pending/throttle coalescing, new branch handling, independent observers and native raw identity. A manual-flush throttled source control used two histories: `a` write, first history `clear()`, then `b` write; after flush the first history undid only `b`, leaving `{a:2,b:1}`, while the second remained undoable. A Node bounded mixed-format control paired CJS `Carburetor` with ESM `CarburetorHistory`: draft `map.set(draft.key,'two')` used the existing raw key, `undo()` restored `'one'` with `sameKey:true` and `canRedo:true`. Loading both development module formats emitted the documented duplicate-copy diagnostics; no bundled application was modified.

**Limits.** These are two reproducible supported-path findings, not a claim that all other paths are defect-free. This isolated review did not run the repository suites/build/lint, React browser renders, synthetic workloads, an exhaustive graph-state matrix, or performance measurements. The parent owns shared validation. No unsupported plain alias guarantees, user-mutated `getData()` or ordinary metadata-only descriptor notification is counted as a defect.

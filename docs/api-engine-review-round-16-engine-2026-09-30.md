# API and engine review, round 16 — engine — 2026-09-30

**Provenance.** Independent xs1 / GPT-6 Sol6 / xhigh review in `worktrees/cycle-review-r16-engine-xs`, based on `54e5ca9d2915ce482381d1d664b5e8a2f61221ba`. The supplied `local://r16-freeze-manifest.json` identifies the identical assigned snapshots as **1,209 files, LF-normalized SHA-256 `51acd25dbe4641da3435c40822c44faa51a5a22cd1f397591eea2455c72d0112`**. This is a report-only review of the dirty frozen candidate, not a repair or a claim that its uncommitted files are disposable. The manifest's typecheck/lint/layout/build, 79/79 focused, 1316/1316 complete, 16/16 packed consumer and nine paired benchmark results belong to the previous integration verification; **none was rerun here**.

**Result: P0 = 0, P1 = 0, P2 = 2, P3 = 1. Not a zero round.** The three findings below are separate: opaque native value ownership, clear-versus-deferred-publication ordering, and a primitive payload colliding with a protocol sentinel. Each has executable actual-consumer proof. No product file, test, generated bundle or prior report was changed.

## R16-ENGINE-01 — Opaque in-place native writes create undo entries that cannot undo (P2)

**Mechanism.** For a Map root, `Carburetor.draft` hands back its raw object, marks a wildcard and reports `PATCH_OPAQUE` (`Store/Carburetor.ts:421-440`); for a nested Map, the write proxy reports `PATCH_OPAQUE` on access and records its owning path (`Store/Tracking/createWriteProxy.ts:314-345`). History faithfully creates a snapshot entry for the ensuing publication (`Tooling/CarburetorHistory.ts:153-224`). But `deepClone` **retains Maps/Sets/Dates by reference** (`Store/Utils/deepClone.ts:14-17`) and history's original `baseline = carburetor.snapshot()` consequently points into the live mutable object (`CarburetorHistory.ts:87-95`). Mutating that object changes the supposed before snapshot as well. `restore` then cannot distinguish the before/after object: the native root's `setData` diff is empty, and a nested native field's raw reference is identical. This is not an unannounced write: a real publication already occurred and history says it can undo it. An ordinary replacement with a *different* Map works, which isolates the in-place opaque case. A standalone `snapshot()` retaining opaque values is an explicitly documented store boundary; this finding is specifically about history claiming a successful undo of an operation it recorded despite that boundary.

**Public consequence.** A consumer using a native Map root, or a nested Map modified through a public store subclass's `update`, sees `canUndo() === true` and `undo() === true`, but the old content is gone, no reversal is published, and redo becomes available for a nonexistent reversal. Set/Date have the same reference-retention route; the executed reproductions below use Map, and do not pretend to have executed every native type.

**Actual-source proof** (`bun -e` from this worktree; `Carburetor` and `CarburetorHistory` from `./lib/src/Carburetor/index.ts`):

```ts
class S extends Carburetor<{m: Map<string, number>}> {
  put(v: number) { this.update(d => { d.m.set('k', v); }); }
}
const s = new S({m: new Map([['k', 1]])});
const h = new CarburetorHistory(s);
const initial = s.snapshot();
let wakes = 0;
s.subscribe(() => wakes++);
s.put(2);
const wrote = {value: s.getData().m.get('k'), saved: initial.m.get('k'),
  version: s.getVersion(), wakes};
const undo = h.undo();
console.log({wrote, undo, current: s.getData().m.get('k'),
  version: s.getVersion(), wakes, redo: h.canRedo()});
```

Observed JSON: `{"wrote":{"value":2,"saved":2,"version":1,"wakes":1},"undo":true,"current":2,"version":1,"wakes":1,"redo":true}`. A separate root-Map probe through the **frozen built CJS** entry printed `{"mid":{"value":2,"snap":2,"version":1,"calls":1,"undoable":true},"undone":true,"after":2,"same":true,"canRedo":true,"version":1,"calls":1}`. A root Map **replacement** control, `setData(new Map([['k', 2]]))`, yielded `afterSet=2`, undo `1`, redo `2`, all successful. A repair must own detached opaque history endpoints (including graph identity/descriptor concerns) or explicitly refuse history attachment/operation for mutations it cannot reverse; do not silently report success or change `snapshot()`'s documented opaque-by-reference contract without a deliberate cutover.

## R16-ENGINE-02 — `clear()` does not cancel history already queued for publication (P2)

**Mechanism.** A history collects `pendingPatches` at mutation time, but its `publication` callback runs through the store's update scheduler (`Tooling/CarburetorHistory.ts:59-73,87-95`; `Store/Transaction/PatchObserverRegistry.ts:127-158`). `clear()` empties only `past` and `future` (`CarburetorHistory.ts:142-146`), not those pending patches or the deferred publication. After `clear()` returns, that queued callback builds a new entry from an operation which occurred *before* the clear (`:168-224`). Neither disconnect nor observer cancellation applies: the history remains attached. Ordinary immediate delivery correctly leaves history empty after a clear.

**Public consequence.** With a coalescing/throttled scheduler, the user can clear an editor's undo stack and subsequently undo the already-cleared change. The store visibly rolls back from 1 to 0 even though **no new action happened after clear**. This is independently reproducible without R15 nested reentrancy or native objects.

**Actual-source proof** (`bun -e`, same import; the deterministic in-memory scheduler implements the public `IUpdateScheduler` shape, and runs no timer or project suite):

```ts
class S extends Carburetor<{n: number}> {
  set(v: number) { this.update(d => { d.n = v; }); }
}
class Manual {
  q = new Map<string, () => void>();
  schedule(k: string, f: () => void) { this.q.set(k, f); }
  cancel(k: string) { this.q.delete(k); }
  flush() { while (this.q.size) {
    const queued = [...this.q.values()]; this.q.clear(); queued.forEach(f => f());
  } }
}
const scheduler = new Manual();
const s = new S({n: 0}, scheduler);
const h = new CarburetorHistory(s);
s.set(1);
h.clear();
const before = {value: s.getData().n, canUndo: h.canUndo()};
scheduler.flush();
console.log({before, afterFlush: {value: s.getData().n,
  canUndo: h.canUndo(), undo: h.undo(), afterUndo: s.getData().n}});
```

Observed JSON: `{"before":{"value":1,"canUndo":false},"afterFlush":{"value":1,"canUndo":true,"undo":true,"afterUndo":0}}`. Immediate-scheduler control: after `set(1); clear()`, `before=true, after=false, value=1`. A fix must establish the clear-time baseline and discard only pre-clear pending work, without dropping genuine writes made after clear but before a coalesced flush, nor disturbing another history's independent observer.

## R16-ENGINE-03 — Public symbol state value collides with absent patch endpoint (P3)

**Mechanism.** String-keyed state accepts a symbol **value** (the ban is on symbol *keys*, `Tracking/AliasLedger.ts:141-155`; `createWriteProxy.ts:360-386`). The patch protocol represents missing property endpoints as the globally obtainable primitive `Symbol.for('react-carburetor/v1/patch-absent')` (`Models/Paths.ts:31-38`), while a present endpoint is the *untyped actual value* (`:48-59`). The write proxy records that value directly (`Tracking/createWriteProxy.ts:407-429`); `installPatch` identifies absence by `value === PATCH_ABSENT` (`Paths/Diff/installPatch.ts:18-41`). Consequently, an own property that actually holds this same legal symbol is indistinguishable from an absent property. Shared immutable `Symbol.for` identity fixed mixed-format decoding of genuine missing keys in R15, but makes this particular value collision identical in every format. This does **not** concern a symbol-keyed state property, which is rejected and is not a finding.

**Public consequence and actual-source proof.** With a public subclass `set(v) { this.update(d => { d.k = v; }); }`, initialize `new S({k: 0})`, construct `new CarburetorHistory(s)`, then `s.set(Symbol.for('react-carburetor/v1/patch-absent'))`. The actual-source run observed `{"saved":{"hasOwn":true,"symbol":true,"canUndo":true},"undo":true,"undone":{"value":0,"hasOwn":true},"redo":true,"redone":{"value":"undefined","hasOwn":false}}`: redo **deletes** the consumer's property instead of restoring its symbol. Reverse-direction proof starting with own `{k: marker}` and setting `k=7` returned `undo=true, hasOwn=false, value="undefined", version=2`; ordinary `Symbol('consumer-state')` restored normally on redo (`hasOwn=true, exact=true`). The frozen mixed-format **CJS store + ESM history** runtime confirmed ordinary history `0→1→undo 0→redo 1`, but the sentinel-valued redo again left `hasOwnAfterRedo=false`; its development duplicate-format warnings were expected. Tagged presence plus value, rather than a legal payload primitive acting as a sentinel, would separate the two states. This is an uncommon, precise primitive-identity collision, hence P3 rather than a claim that arbitrary symbols fail.

## Complete engine surface examined and controls

- **Paths, prototypes, state and proxies:** traced `Carburetor`, `isTrackable`, alias validation, read/write proxy traps, proxy cache, escaped path joins, branch/key markers, `SubscriberIndex`, `WriteLog`, diff/patch/restore, root replacement and write publication. An actual-source null-prototype root with literal `a.b` and nested `a.b` read paths `['a~1b','a.~p','a.b']`; writing the literal key woke its own subscriber once and the nested-path subscriber zero times. Inherited ordinary object names can become own tracked keys; inherited array methods remain untracked. Ordinary arrays with Array/Object/null prototype are the supported array boundary; genuine Array subclasses are not made into class-selection snapshots. Non-index own array state fields, own symbol **keys**, accessors and plain store-state cycles are rejected by the development state model, not additional bugs about dropped snapshots. The supported selection graph has a deliberately wider own-descriptor/cycle boundary than store state.
- **Selection ownership:** traced `sameSelection`, `detachOpaque`, `detachSelection`, `detachWatchSelection`, `liveViews` and `buildPersistentView`/facade traps, including root re-resolution, raw native descriptor lookup versus facade path reads, graph-pair comparison, topology, prototypes, ordinary array length/holes and explicit accessor rejection. An actual-source `watch` on a Map with hidden non-writable self-link observed old `k=1`, new `k=2`, a copied self-link, `writable=false`; an own native accessor threw with getter-call count **0**. This validates *selection* native detachment, and must not be confused with store `snapshot()`'s opaque-by-reference contract or the history defect above. A native root's direct store read records a wildcard; plain/array reads are path-specific. Custom instances remain an explicitly live/opaque boundary, not a promise to clone private fields.
- **History and registry:** traced patch generation, `PATCH_ABSENT`/`PATCH_OPAQUE`, independent observer attachment/disposal, pre-subscriber publication, reentrant writes, coalesced throttle/transactions, restore ownership, history limits and both replay directions. The R15 independently attached histories and own-restore suppression are present in the frozen code (`PatchObserverRegistry.ts:17-159`, `CarburetorHistory.ts:64-73,153-283`); **no new claim that every reentrant observer ordering was executed here**. Our native and deferred-clear probes cover new histories paths outside those R15 repairs.
- **Derived and delivery:** traced `Computed` pull/settle, `computedDependencies` cross-copy external bridges, native epoch/leaf version drift, update wave, subscriber-generation isolation, throttle cancellation/reentrant flush and batch drain. Actual-source conditional computed `d[d.use]` with an unrelated write, equal-valued branch change, old-branch write, then new-branch write observed initial `1`, final `4`, body evaluations `3`, notifications `1`, computed version `1` and store version `4`. This is a bounded correctness control, not a throughput benchmark.
- **Consumers, scopes, module copies:** traced class render-attempt→commit alignment, persistent facade source swap/root re-resolution, selection identity, hook selector/comparator/getSnapshot lifetime, computed hook snapshots, scope token ownership/hydration, persistence and DevTools composition. Actual-source two-scope hydration from one `__proto__`-named payload preserved the own key and yielded independent data (`a=7`, `b=1`, original payload `1`). A frozen **built** CJS store supplied a raw-first Map-key selection to an ESM `AntiHookComponent.connectSelection` class and a CJS `useCarburetorValue` hook: real React server rendering yielded `<span>answer|true</span>` for each. The expected development two-copy warnings were printed. SSR proves this selection and alias identity, **not** mounting, browser repaint, source-swap subscriptions or GC reclamation.

**Costs and verification limits.** This review ran small direct TypeScript `bun -e` and frozen built Node/React-SSR probes only. It did **not** run a build, lint, formatter, project test, benchmark, Chromium session, installed-package matrix or allocation/throughput measurement; the full gates and the nine paired medians in `docs/api-engine-review-round-15-integration-2026-09-30.md` are previous integration observations, not evidence of zero findings or a speedup caused by this report. Specifically those prior observations include slower replay in one measured driver, resource wire history materially more expensive, and canceled/ordinary delivery overhead; proposed fixes here cannot honestly be called free without new post-repair measurements. An earlier disposable throttle probe armed a very long timer, yielded the same clear repro, and was terminated; the definitive `Manual`-scheduler probe above exits normally and leaves no files/processes. No standalone production allocation, real mounted source-swap, third-party scheduler exception or GC claim is inferred from static review. The next independent complete API+engine round is needed after these findings are repaired and integrated; this round cannot be labeled zero.

# Round 17 independent API/engine review — engine — 2026-09-30

**Freeze and ownership.** Independent report-only review of the engine worktree on `master` `4897d34`, product `a594e1c`. The supplied round-17 manifest records **1,214 identical source/doc and copied built-distribution files**, LF-normalized SHA-256 `08d18ad84173803d82e843c1ecf1061ccfc3f1529ada1049e1650576c654df1c` in both assigned review worktrees. Product and `dist` were read-only here; this report is the sole change. Earlier integration's 97 focused/1,356 full tests, 16 packed consumers, 54 cross-format cases and browser result are **parent evidence, not tests run by this reviewer and not proof of a clean round**.

**Verdict: P0 = 0, P1 = 0, P2 = 2, P3 = 2. Not zero.** Findings below are independent of the previous round's named repairs. Actual bounded source and copied-build executions reproduced the first three; the fourth has deterministic, instrumented source-work evidence. Severity ranks lost reads/history semantics ahead of extra work. No workaround based on disregarding a supported draft/read view is an acceptable repair.

## R17-ENGINE-01 — Native collection methods receive trackable proxy identities instead of raw graph aliases (P2)

**Location / mechanism.** `Store/Tracking/createReadProxy.ts:236-279` wraps a plain `key` but passes `map` through unwrapped; `Store/Tracking/createWriteProxy.ts:317-347` does likewise for a draft. The write trap only unwraps a proxy at *assignments through the write proxy* (`:23-32,363-400`), not arguments passed to a raw `Map`/`Set` intrinsic. A plain object which is both `state.key` and a native Map key therefore has different identities as `readView.key`/`draft.key` and as the Map's raw key. `map.get(view.key)` misses; `draft.map.set(draft.key, value)` adds a second entry instead of updating the existing one. `Map.set('root', draft)` and `Set.add(draft.key)` also store proxy rather than raw root/key. `Tooling/CarburetorHistory.ts:40-104` and `Store/Utils/Selection/detachOpaque.ts:75-155` cannot reconstruct the intended alias from a leaked write proxy: undo/redo faithfully carry the wrong graph. This is a **read and mutation** defect, not merely a React facade display issue; fresh Map instances or a raw Map root are not required to reproduce it.

**Deterministic actual-source consumer proof** (executed with `bun -e`, public exports from `./lib/src/Carburetor/index.ts`):

```ts
class S extends Carburetor {
  put(v) { this.update(d => d.map.set(d.key, v)); }
}
const key = {id: 1}, s = new S({key, map: new Map([[key, 1]])});
const h = new CarburetorHistory(s);
s.put(2);
const mid = {value: s.getData().map.get(s.getData().key), size: s.getData().map.size,
  keys: [...s.getData().map.keys()].map(k => k === s.getData().key)};
h.undo(); h.redo();
console.log(JSON.stringify({mid, afterRedo: {
  value: s.getData().map.get(s.getData().key), size: s.getData().map.size}}));
```

Observed `mid={"value":1,"size":2,"keys":[true,false]}`, `afterRedo={"value":1,"size":2}`. **Expected** a single key, value `2` both after write and redo. Independent actual-source read control with initial `Map([[key,7]])` printed `raw=7, selected=null, computed=null, paths=["map","key.~p"]` for `s.read(record).map.get(s.read(record).key)` and `new Computed(get => { const d=get(s); return d.map.get(d.key); }).get()`; `watch(d => d.map.get(d.key),...)` received **zero** changes after a raw-key update from `7` to `8`. An actual-source native topology control `d.map.set('root',d); d.map.set('key',d.key); d.set.add(d.key)` produced `root=false,key=false,set=false` both immediately and after undo/redo. Conversely `d.map.set(s.getData().key,2)` updated the existing Map entry; that control isolates proxy identity rather than Map detachment itself.

**Copied built consumer proof.** A CJS `Carburetor` store paired with an ESM `CarburetorHistory` reproduced `{miss:{raw:1,size:2},redo:{raw:1,size:2}}`. Another mixed CJS store / ESM `Computed` read returned `undefined` for both tracked read and computed while raw Map lookup was `7`. Development printed the expected cross-format two-copy warnings; they do not explain away the wrong key lookup.

**Scope / minimal acceptance.** Preserve canonical aliases when native Map/Set methods see plain members/root through both read and write views, including raw-first Map-key traversal, nested methods, root backlinks, selected `watch`/`Computed` values, undo/redo and mixed CJS/ESM. Do not turn native keys into a second independent clone or suppress read tracking to hide the miss. Existing raw-key updates and descriptor-safe native graph copying must remain intact.

## R17-ENGINE-02 — Undo during a queued newer write creates a phantom step and destroys redo (P2)

**Location / mechanism.** Mutation patches are collected immediately (`Tooling/CarburetorHistory.ts:276-302`), but `record()` runs only when `PatchObserverRegistry.publish()` schedules the publication (`Store/Transaction/PatchObserverRegistry.ts:129-161`). `undo()`/`redo()` pop/push the prior published entry without settling a pending later write (`CarburetorHistory.ts:230-255`). Replay `apply()` resets `applying` around `restore`, then deferred `record()` sees the pending newer mutation as a fresh branch (`:304-342,389-425`); its baseline and saved patch sequence no longer describe the current state. This is distinct from the repaired clear boundary, which explicitly resets pending patches (`:258-269`).

**Deterministic actual-source consumer proof** (`bun -e`, same public imports):

```ts
class S extends Carburetor { put(n) { this.update(d => { d.n = n; }); } }
class Queue {
  q = new Map();
  schedule(k, cb) { this.q.set(k, cb); }
  cancel(k) { this.q.delete(k); }
  flush() { while (this.q.size) {
    const callbacks = [...this.q.values()]; this.q.clear(); callbacks.forEach(cb => cb());
  } }
}
const q = new Queue(), s = new S({n: 0}, q), h = new CarburetorHistory(s);
s.put(1); q.flush();         // one committed entry
s.put(2);                    // newer write not yet delivered
const first = h.undo(), immediate = s.getData().n;
q.flush();
console.log({first, immediate, final: s.getData().n,
  canUndo: h.canUndo(), canRedo: h.canRedo(), second: h.undo(), afterSecond: s.getData().n});
```

Observed `first=true, immediate=0, final=0, canUndo=true, canRedo=false, second=true, afterSecond=1`. **Expected** coherent publication order: either settle the pending `1→2` before undoing it (`2→1`, with redo still valid until a genuinely new branch), or explicitly decline/reconcile the operation; never replace the latest change with `0`, then silently erase redo and produce an alleged second undo that moves forward to `1`. This occurs with plain `{n:number}`, no native ownership or custom producer. The copied-built CJS store / ESM history produced the same JSON, including `afterSecond=1`.

**Scope / minimal acceptance.** Handle pending patch and opaque entries before both undo *and* redo with a manual coalescing scheduler and a transaction; retain correct independent histories, replay-cancellation ownership, subscriber reentry, clear-before-flush plus later writes and normal coalescing. A successful undo must genuinely reverse the latest coherent step; a later flush must not manufacture a historical change or wrongly drop redo.

## R17-ENGINE-03 — Merely reading a native value during `update` creates a successful no-op undo (P3)

**Location / mechanism.** Accessing a nested native object reports `PATCH_OPAQUE` and a write path in `createWriteProxy.ts:335-345` before any intrinsic is invoked; a native root's `draft` does the same in `Store/Carburetor.ts:436-449`. `CarburetorHistory.record/buildEntry` creates a snapshot entry without checking whether owned `before` and `after` have any observable difference (`Tooling/CarburetorHistory.ts:304-375`). Undo adopts an equal-content but newly copied native object and reports success (`:230-242,389-425`). The conservative store wake for a potential opaque mutation can remain, but a user-visible undo step for a read is not a change.

**Actual-source and copied-built proof.** In both `bun -e` source and `node -e` copied CJS build, use:

```ts
class S extends Carburetor { touch() { this.update(d => { void d.m.get('k'); }); } }
const s = new S({m: new Map([['k', 1]])}), h = new CarburetorHistory(s);
s.touch();
const before = {undo: h.canUndo(), value: s.getData().m.get('k'), version: s.getVersion()};
const applied = h.undo();
```

Built output: `before={"undo":true,"value":1,"version":1}`, `applied=true`, `after={"undo":false,"redo":true,"value":1,"version":2}`. A native **Map root** with a `touch()` calling `this.update(d => { void d.get('k'); })` also returned `undo=true`, then incremented version a second time on a no-content-change undo. **Expected:** a conservative publication, if required for opaque writes, does not insert an undoable entry for an unchanged owned graph; `canUndo()` remains false and `undo()` returns false. This affects Map/Set/Date read-only access and equal-content native operations; no claim that arbitrary unsupported mutable class instances can be compared or copied generically.

**Minimal acceptance.** Do not claim successful empty history steps for supported native graphs whose intrinsics/own descriptors/topology are unchanged, while still recording an in-place native mutation and preserving cyclic/native aliases. Do not simply suppress the wildcard on every native access: a later call may mutate it.

## R17-ENGINE-04 — Opaque fallback discards a complete speculative plain copy before copying it again (P3, cost)

**Location / mechanism.** `Tooling/CarburetorHistory.ts:40-104` first builds `seen` and recursively allocates a detached ordinary-object/array graph. A native or nonstandard member sets `opaque`; the function abandons the partially created graph and calls `detachOpaque(value,...)` from the root, retraversing and reallocating all earlier plain branches (`Store/Utils/Selection/detachOpaque.ts:75-230`). Native descriptor/intrinsic fidelity is essential, but an unavoidable native fallback does not require *two* ownership traversals/copies of all preceding plain rows on **every** history capture. The cost grows with the location and size of a native member; no byte-allocation figure is inferred from traversal counts.

**Bounded deterministic source proof** (`bun -e`, count calls on the **same original** objects, not aggregate clone count):

```ts
const state = {rows: Array.from({length: 5}, (_, id) => ({id, label: 'x'})),
  last: new Map([['a', 1]])};
const original = Reflect.ownKeys, visits = new Map();
Reflect.ownKeys = function (object) {
  visits.set(object, (visits.get(object) || 0) + 1); return original(object);
};
try {
  const h = new CarburetorHistory(new Carburetor(state));
  console.log({root: visits.get(state), array: visits.get(state.rows),
    rows: state.rows.map(row => visits.get(row)), native: visits.get(state.last)});
  h.disconnect();
} finally { Reflect.ownKeys = original; }
```

Observed `root=2,array=2,rows=[2,2,2,2,2],native=1` **for one capture**, with unchanged state and zero history steps. Necessary ownership requires visiting each ordinary original once for this capture; the second visit and its abandoned first-round containers are avoidable. This is a P3 cost for sizable mixed plain/native history graphs, not an assertion that the pure-plain resource measurement below is caused by this fallback.

**Minimal acceptance.** On a supported mixed graph, own it once without discarding an already-created standard-shape plain copy when a native member is found; retain native intrinsics, full own-data descriptors, cycles, Map key/root backlinks, fresh immutable endpoints, and explicit unsupported-class/accessor refusal. Reassess work under a comparable bounded mixed graph; do not claim byte savings based only on `Reflect.ownKeys` counts.

## Additional scope, controls and verification limits

- Traced `Carburetor` mutation, restore, epoch/wave scheduling, batching and `WriteLog`; read/write proxy traps and caches; escaped paths, presence flags, array length/holes, `diffPaths`/`applyDiff`/`installPatch`, alias ledger, indexed subscriber matching, ordinary/native ownership copier, opaque classification, selection comparison, computed leaf drift, observer registry, history replay and resource producer-owned wire capture. Source imports were cross-checked against the copied CJS/ESM public entry exports. A `typescript-language-server` symbol-definition attempt failed during initialization because it could not locate a compatible TypeScript language-service installation for this worktree's TypeScript 7 binary; no false LSP-result claim is made.
- Independent actual-source control: ordinary Map/Set/Date with an **explicit raw key** kept Map lookup, Set membership, Date time, hidden non-configurable Map root backlink, null-prototype dictionary, sparse array hole and correct undo/redo across two histories. `history.clear()` after a pre-clear queued write, followed by a post-clear queued write and flush, left an undoable `2→1` step; the earlier history retained its independent state. A native accessor refused capture with **zero getter calls**; a callable reference was retained without claiming generic function state ownership. These controls delimit the findings, not universal proof for every graph.
- Performance is **not waived**: the supplied earlier final paired observations are **129 captures on both sides, 21.027 ms current versus 6.848 ms older correct wire-history baseline** on 64 loads/128 transitions, with reported ranges 17.410–28.045 and 4.845–8.989 ms. That workload is *pure plain* (`benchmarks/state/resourceHistory.mjs:30-32,75-84`) and does **not** invoke R17-ENGINE-04's mixed-native fallback. A bounded independent plain 4-row/one-load probe counted 23 extra `Object.getOwnPropertyDescriptor` calls after history attachment, versus zero without history; that demonstrates descriptor-safe ownership work, **not** by itself that any of those calls can be deleted without loss of fidelity or that 21.027 ms is entirely avoidable. The native fallback's deterministic duplicated walk is the separately actionable P3. No byte allocations or timings were measured by this reviewer.
- This report ran only the stated bounded `bun -e` actual-source and `node -e` prebuilt CJS/ESM consumer probes and small work counters, without a project build, formatter, lint, suite, benchmark run, package pack, browser/React UI visit or native Rust run. Earlier integration gates are not reattributed to this review. No product file, generated bundle, dependency, user-owned state or throwaway on-disk probe was changed.

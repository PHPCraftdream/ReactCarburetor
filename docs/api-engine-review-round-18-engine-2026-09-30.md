# Round 18 independent API/engine review — engine — 2026-09-30

**Freeze and ownership.** Read-only product review in `cycle-review-r18-engine-xs`, on master `d61ee16` / product `60e4cb8`. The supplied round-18 manifest records 1,224 identical source/documentation/copied-build files in the two review worktrees, LF-normalized SHA-256 `1f12fed4f048d138743f13613b8f4e231544849b93bd321207af6276b5452828`. This report alone is committed in my worktree. The parent-reported 1,371 tests, 16 consumers, 72 cross-format cases and browser gate predate this independent review; they are not this reviewer's proof of zero.

**Verdict: P0 = 0, P1 = 0, P2 = 2, P3 = 0. Not zero.** Both findings are consumer-observable with supported ordinary data and public store/history/computed operations. The array-descriptor case is expressly exercised as a supported draft operation in `__tests__/Engine/Store/Tracking/WriteProxyArrayPrecision.test.ts:390-411`; neither report depends on unsupported native subclasses or mutating the raw store behind its back.

## R18-ENGINE-01 — Plain member reached through a native collection misses writes to its other tracked path (P2)

**Location / mechanism.** `lib/src/Carburetor/Store/Tracking/createReadProxy.ts:256-280` records only `map` on a native leaf. `Store/Tracking/liveViews.ts:81-95` forwards `Map.get` to the raw Map and returns its raw plain member, with no tracked path for its fields or canonical alias subscription. `Store/Tracking/createWriteProxy.ts:299-326,345-417` correctly records a draft write to the separate `row.n` path. `Store/Paths/SubscriberIndex.ts:168-193` and `Store/Paths/WriteLog.ts:87-114` cannot infer that `map` and `row.n` address the same object. The graph is supported: a plain object is both an own root field and a Map value, exactly the native/plain link history must retain; the native collection itself is the documented coarse leaf, not an unsupported custom subclass. No user-originated `getData()` mutation is involved.

**Actual-source reproduction.** Run using public exports with `bun -e` from this worktree:

```ts
import {Carburetor, Computed} from './lib/src/Carburetor/index.ts';
class Store extends Carburetor {
    put(n: number) { this.update(d => { d.row.n = n; }); }
}
const row = {n: 1};
const store = new Store({row, map: new Map([['row', row]])});
const events: number[] = [];
const stop = store.watch(d => d.map.get('row')!.n, n => events.push(n));
const computed = new Computed(get => get(store).map.get('row')!.n);
let wakes = 0;
const id = computed.subscribe(() => wakes++);
const first = computed.get();
store.put(2);
console.log({first, raw: store.getData().map.get('row')!.n,
    events, computed: computed.get(), wakes});
stop(); computed.unsubscribe(id);
```

Observed `first=1, raw=2, events=[], computed=1, wakes=0`; a separate tracked read recorded only `paths=["map"]`. **Expected:** after the supported draft write, selection is `2`, `watch` receives the change, and subscribed `Computed` refreshes/announces it. A copied-built mixed-format control (`require('./dist/cjs/Carburetor/index.js')` store plus `import('./dist/esm/Carburetor/index.mjs')` computed) independently gave `{"actual":2,"computed":1,"delivered":0}`. The expected two-copy development warnings appeared; they do not cause the missed invalidation.

**Minimal acceptance and call scope.** Ensure native collection reads which expose a reachable plain alias (Map value, Set member, key, own native data field or root backlink) cannot remain subscribed only to an unrelated coarse path when a supported draft write mutates the same object through its ordinary tracked path. Show actual `watch`, live `Computed`, render/read subscriptions and drift against the same aliased graph; retain raw Map/Set entry semantics, native receiver/chaining/`forEach` behavior, canonical argument aliases, and history root links. Merely ignoring tracking or forcing `get()` to recompute on all writes is not a semantic fix.

## R18-ENGINE-02 — Native array length descriptor lock leaves history unable to undo and moves cursor on failure (P2)

**Location / mechanism.** `lib/src/Carburetor/Store/Tracking/createWriteProxy.ts:172-285,440-449` forwards `Object.defineProperty(draft.items, 'length', {value: 1, writable: false})` and records removed indices/length *values*, but not the writable flag. `Store/Paths/Diff/installPatch.ts:18-41` subsequently replays just those values. `Tooling/CarburetorHistory.ts:242-255,445-499` moves the entry from past to future **before** reconstructing/restoring; undo tries to grow the still-locked live array through `Store/Paths/Diff/applyDiff.ts:65-80` and throws on its write. The source test named above explicitly accepts `defineLength({value: 1, writable: false})`, verifies the lock and publishes the truncation, so the operation is not an invalid-input hypothesis.

**Actual-source reproduction.** Run with public exports using `bun -e`:

```ts
import {Carburetor, CarburetorHistory} from './lib/src/Carburetor/index.ts';
class Store extends Carburetor {
    lock() { this.update(d => { Object.defineProperty(d.items, 'length',
        {value: 1, writable: false}); }); }
}
const store = new Store({items: [1, 2]});
const history = new CarburetorHistory(store);
store.lock();
console.log(store.getData().items.length, history.canUndo());
try { console.log(history.undo()); } catch (error) { console.log(String(error)); }
console.log(history.canUndo(), history.canRedo(), store.getData().items.length);
history.disconnect();
```

Observed before undo `length=1, canUndo=true`; undo throws `Proxy object's 'set' trap returned falsy value for property 'length'`, and afterwards `canUndo=false, canRedo=true, length=1`: neither state nor cursor is coherent. The copied CJS build reproduced the same behavior, and the mixed CJS store/ESM history reproduced `{"length":1,"writable":false,"error":"'set' on proxy: trap returned falsish for property 'length'","past":false,"future":true}`. Separately `Object.defineProperty(draft.items, 'length', {writable:false})` without length change changed the descriptor but produced `version=0, events=0, canUndo=false` in the actual source, so the flag-only transition is unaccounted for as well. The failed undo's unpublished-draft development diagnostic is a consequence, not the root defect.

**Expected / minimal acceptance and call scope.** For the already-supported array-length definition, record the actual descriptor/content transition and invert it without attempting to mutate a non-writable array in place. A successful undo restores the original length, elements and writable flag; redo restores the locked truncated form; a failure must not corrupt the cursor. Descriptor-only locking must have a coherent published/history result. Preserve native array `RangeError` conversion behavior, partial truncation at non-configurable indices, sparse holes, index presence flags, non-writable existing length refusals, independent recorders and queued replay. Rejecting this already-accepted input after the fact, suppressing the error, or simply deleting history for locked arrays is not acceptance.

## Reviewed scope, bounded controls and limits

- Inspected store read/write/restore/emit flow, proxy traps and weak branch cache, native facade canonicalization, method receiver/`forEach`/chaining, alias ledger, read/branch/key markers, subscriber matching and write-log drift; `diffPaths`, `applyDiff`, patch installation and arrays; computed dependency attachment, freshness, announcement and wave; batch, throttle and patch observer delivery; resource cache lifecycle/eviction/view reconciliation; history pending/clear/replay and snapshot ownership/equality. Read both public and copied CJS/ESM entry behavior. These are reviewed mechanisms, not a claim of exhaustive state-space proof.
- Actual bounded native graph control: Map key from a draft proxy, Map self-reference, hidden symbol own descriptor referring back to the root, Set member/root, Date intrinsic, null-prototype dictionary and sparse array survived source history undo/redo: `before=1,after=2,old=1,redo=2,self=true,root=true,proto=true,hole=true,time=11`. Native chained `Map.set`/`Set.add` and both `forEach` collection/`thisArg` controls printed `chain=true,map=true,set=true`, retaining raw entry keys. These passing controls do not waive R18-ENGINE-01's alias tracking miss.
- Actual bounded manual-scheduler control with two independent histories: pending write undo/redo both returned `true`; after `clear`, a later write was undoable `4→3`, and the other history still had undo. Actual bounded resource-cache source control loaded two keys, invalidated one, then history undo restored its unstale view (`first=1,second=2,stale=true,undone=true,after=false,entries=2`). A non-configurable array-index partial truncation also undid and redid correctly (`length 2`, `undo=true,redo=true`); these controls delimit the array descriptor defect.
- Ownership cost/fidelity: a single source-side 5-row ordinary graph plus native Map history construction counted `Reflect.ownKeys` visits to the **original** root, five original rows and native Map at `1`, `[1,1,1,1,1]`, `1` respectively. This is reflection work, **not** allocated bytes. Map/Set/Date intrinsics, own descriptors, aliases and immutable before/after history endpoints require ownership work; I found no independently demonstrated avoidable copying with unchanged fidelity on this freeze, so no speculative P3 cost finding. Parent's 129-capture resource paired numbers `31.442→33.437 ms` were not rerun here and are not called an improvement or used as this review's severity proof.
- A Windows `typescript-language-server` 5.1.3 LSP definition request was attempted; initialization replied `Could not find a valid TypeScript installation` for this workspace's TypeScript setup. No symbol-resolution result is claimed. Source navigation above was direct, not LSP evidence.
- This report used only bounded actual-source `bun -e`, pre-existing copied-build `node -e`, code/doc reads, and a small original-node reflection counter. It did **not** run project-wide tests, lint, formatter, build, pack, benchmark, browser UI, or native Rust; no source, dependencies, generated artifacts or user-owned state were changed. Consequently no unreviewed subsystem is silently certified clean, and the two verified P2 findings prevent a zero verdict regardless of earlier parent gates.

# Independent API and engine review, round 20 — engine — 2026-09-30

**Target:** isolated `cycle-review-r20-engine-xs`, frozen product commit `60795449d72b00b97f8b63ee461aa6be59326085`. Review-only: no product, tests or generated output modified. Bounded probes imported this worktree's actual TypeScript with `bun -e`; the separate CJS/ESM identity control imported this worktree's supplied packed `dist` with Node. No test suite, build, lint, formatter, benchmark or synthetic load was run.

**Result: P0=0, P1=0, P2=3, P3=0.** Each finding below has an independently observed supported public-API reproduction. The three faults concern the same observable property—enumeration order—but lie at three independently actionable boundaries: replacement invalidation, selection equality after a *matched* write, and history inversion after a *published* deletion. A fix to one boundary alone does not repair the other two.

| ID | Severity | Consumer-visible defect |
| --- | --- | --- |
| R20-ENG-01 | P2 | Replacing a plain object with the same entries in a different insertion order publishes nothing; key-order readers and history miss the replacement. |
| R20-ENG-02 | P2 | A matched, published draft reorder reruns `watch` but its detached plain-object result is declared unchanged, so the callback keeps an obsolete key order. |
| R20-ENG-03 | P2 | Undoing a published plain-object key deletion restores the value at the end, not at its original position; undo succeeds but does not restore the original `Object.keys` result. |

## R20-ENG-01 — equal key sets obscure replacement order

**Where and why.** `lib/src/Carburetor/Store/Paths/Diff/diffPaths.ts:64-95` compares the membership and values of `Object.keys` but not its iteration order. When both objects have the same keys and equal values, `walk` returns no changed path (`:98-127`); `Carburetor.setData` passes that empty set to `emitUpdate` (`Store/Carburetor.ts:159-183`), whose touched/no-writes branch returns without incrementing the version or notifying subscribers (`:564-580`). The documented supported plain object state is enumerable own string-keyed data, and enumerating through a tracked read is expressly an observable structural selection (`README.md:244-265,890-897`). Insertion order of non-integer own string keys is observable through `Object.keys`, iteration, spread and serialization. This is not a raw mutation, an unsupported descriptor, or reference-equal input: `setData` adopts a fresh ordinary object.

**Executed actual-source public probe:**

```ts
const s = new Carburetor({item: {a: 1, b: 2}});
const seen: string[][] = [];
const stop = s.watch(d => Object.keys(d.item), next => seen.push(next));
s.setData({item: {b: 2, a: 1}});
console.log({keys: Object.keys(s.getData().item), seen, version: s.getVersion()});
stop();
```

Observed `{"keys":["b","a"],"seen":[],"version":0}`. Expected a notification with `['b','a']` and an incremented version: the tracked `Object.keys(d.item)` result changed from `['a','b']` despite unchanged key membership and values. A separate public `CarburetorHistory` control created before this replacement reported `canUndo:false`, `undo:false`, and retained `['b','a']`: publication never reached its observer. **Remedy:** treat a changed ordered own-key sequence as a structural write (including the key-set/enumeration marker), not merely differences in set membership; ensure history receives that publication and can restore order. Preserve unchanged same-order replacements as no-ops and avoid waking unrelated leaf readers.

## R20-ENG-02 — a matched selection ignores key order

**Where and why.** `lib/src/Carburetor/Component/Connection/sameSelection.ts:22-66` obtains both `Reflect.ownKeys` arrays, but tests only their lengths. It subsequently looks up each *old* key in the fresh graph; it never compares the key sequences. `Carburetor.watch` reruns the selector upon a matched write but skips detachment and `onChange` when this comparison returns true (`Store/Carburetor.ts:364-385`). A plain projected object is a supported detached selection; its own-key order is part of what the consumer sees. This does not depend on ENG-01: the draft deletion and reinsertion below records/publishes a real change, and the selector is actually rerun.

**Executed actual-source public probe:** a subclass uses its supported protected `update` to delete and reinsert `a` in one publication; the selector spreads `d.item`, which enumerates its keys and reads their values.

```ts
class S extends Carburetor<{item: {a?: number; b: number}}> {
  move() { this.update(d => { const a = d.item.a; delete d.item.a; d.item.a = a; }); }
}
const s = new S({item: {a: 1, b: 2}});
let runs = 0;
const seen: string[][] = [];
const stop = s.watch(d => { runs++; return {...d.item}; }, next => seen.push(Object.keys(next)));
s.move();
console.log({runs, seen, raw: Object.keys(s.getData().item), version: s.getVersion()});
stop();
```

Observed `{"runs":2,"seen":[],"raw":["b","a"],"version":1}`. Expected `onChange` with a newly detached result whose keys are `['b','a']`; the earlier selection's keys were `['a','b']`. A gated selection consumer can likewise retain a stale snapshot after an otherwise valid publication. **Remedy:** compare ordered own-key sequences before descriptor/value comparisons, retaining the existing alias-topology and exotic-value rules; continue recognizing genuinely unchanged selection content as equal.

## R20-ENG-03 — patches cannot invert ordinary key positions

**Where and why.** A deletion produces a describable patch (`lib/src/Carburetor/Store/Tracking/createWriteProxy.ts:535-563`), and history takes its fast patch path (`Tooling/CarburetorHistory.ts:353-380,487-499`). Undo reconstructs from the post-deletion baseline and applies the inverse (`:560-568`); `Store/Paths/Diff/installPatch.ts:29-41` recreates a deleted key by assignment. Assignment appends a non-integer string key to the object's existing key order. `restore` cannot recover the original position because its `applyDiff` also adds the key by assignment (`Store/Paths/Diff/applyDiff.ts:81-105`). The history graph comparator itself considers ordered own keys (`Tooling/sameHistoryGraph.ts:46-55`), but no ordering metadata is stored in an ordinary patch. No native object, unsupported alias, descriptor or synthetic load is involved.

**Executed actual-source public probe:**

```ts
class S extends Carburetor<{a?: number; b: number}> {
  remove() { this.update(d => { delete d.a; }); }
}
const s = new S({a: 1, b: 2});
const h = new CarburetorHistory(s);
s.remove();
const changed = Object.keys(s.getData());
const undone = h.undo();
console.log({changed, undone, undoKeys: Object.keys(s.getData())});
h.disconnect();
```

Observed `{"changed":["b"],"undone":true,"undoKeys":["b","a"]}`; before deletion the keys were `['a','b']`. Expected undo to restore the exact previous public state, including enumeration order. A second bounded control deleted and reinserted `a` in one `update`: history recorded an entry and returned `true` for both undo and redo, but the order remained `['b','a']` throughout rather than reverting to `['a','b']` on undo. **Remedy:** retain sufficient ordered-container state for patches that remove/reinsert a non-integer own key and replay it without losing the order through `restore`, or use owned whole-container endpoints at this boundary. Keep ordinary scalar patch writes on their existing fast path.

## Examined engine breadth, controls and limits

- Inspected the full store publication lifecycle (`read`, draft, `setData`, `restore`, `fromJSON`, `emitSoon`, raw fallback, write log, subscriptions and watch), read/write proxy traps, array length conversion and partial truncation attribution, native collection receiver/canonical-key wrappers, root ownership index and invalidations, development alias/state checks, proxy caches, descriptor and symbol boundaries, key/branch markers, subscriber index, diff/apply/clone and native identity registry. The three findings all use valid ordinary enumerable string-keyed data; the report does not extrapolate from production-only unchecked input or unsupported class/array subclasses.
- Inspected nested transactions, update waves, deferred throttle cancellation/reentrancy, computed dependency attachment/rollback, unobserved freshness, external bridges, leaf versions and subscriber generations. A bounded actual-source native-alias/transaction/computed control read a Map member alias of an ordinary `row`, wrote `row.id` and another leaf through one `update` inside `transaction`, and observed `seen:[2]`, computed callback values `[5]`, and `current:5`. Replacing that Map's existing entry through a draft facade using a tracked `row` key retained the raw key (`sameKey:true`). No additional P0–P3 finding was established in these paths.
- Inspected history ownership of native contents/own descriptors and locked array length, patch observer fanout, pending/clear/opaque/primitive-patch states, cursor failure and replay, new branches, independent recorders and key-order-sensitive equality. A bounded native graph with `row` both as ordinary sibling and Map key/value was recorded by two histories; after a marker write each could undo, and one undo retained `map.get(row) === row` in its owned replay. The second recorder retained its own undoable branch, as expected. This is a control, not a full replay-state proof for every shape.
- Inspected cross-module `sharedSingleton` and weak live-view identity. A bounded Node probe mixed supplied CJS and ESM output: an ESM history could attach to a CJS store, while a CJS read view passed as a draft Map key normalized to the raw key. It printed `normalized:true`, `sameRaw:true`; development emitted the documented duplicate-module diagnostics. This checks one cross-format identity path, not every bundler/runtime permutation. No other tests or build steps were run; browser/React render surfaces, exhaustive supported-state combinations, production allocation comparisons and full cross-module matrix were not exercised here. Source inspection and the bounded controls are not a claim that all remaining paths are defect-free.

# Independent API and engine review, round 21 — engine — 2026-09-30

**Target and method.** Isolated `cycle-review-r21-engine-xs` at frozen product commit `9008b8f749bb63b25d335c6ba4dab5bb213a4def`. Reviewed actual engine source, documented supported state/read contracts and selected existing tests; exercised small public-API probes with Bun against this tree's TypeScript and Node against its supplied packed CJS/ESM `dist`. This review changes no product, test or generated file. No suite, build, lint, formatter, benchmark or synthetic load was run here.

**Verdict: P0=0, P1=0, P2=2, P3=0. Not a zero combined round.** Both P2s are separately actionable missed reactive updates after supported writes, and both reproduced against the supplied packed consumer output as well as actual source.

| ID | Severity | Consumer-visible consequence |
| --- | --- | --- |
| R21-ENG-01 | P2 | A watched plain branch stops following a later leaf after a different leaf changes first: the new detached value has the second leaf, but its next change never calls `onChange`. |
| R21-ENG-02 | P2 | A native Map member's newly established ordinary alias is absent from a previously built root index after a same-content identity replacement; a subsequent ordinary write changes that Map member without notifying its reader. |

## R21-ENG-01 — changed selection detached after its new reads are filed

**Mechanism.** `lib/src/Carburetor/Component/Connection/sameSelection.ts:39-72` uses `previousKeys.every(...)`: comparing the first changed descriptor/value returns false immediately, before the fresh live proxy's remaining properties can be read and recorded. `lib/src/Carburetor/Store/Carburetor.ts:370-384` then replaces the watch registration with `transferReads(fresh.reads, id)` *before* `detachWatchSelection(fresh.value)` traverses the full next branch. Detachment grows the transferred `Set`, but `SubscriberIndex.add` had already filed its earlier contents (`Store/Paths/SubscriberIndex.ts:76-107`); no subsequent `extend` files the late paths. The retained previous branch and the next callback can therefore disagree even though both draft writes published and increased the version. This is ordinary enumerable string-keyed state, using the supported `watch`/protected `update` surface rather than descriptor-only introspection.

**Executed actual-source public probe** (also repeated with Node's packed `dist/cjs/Carburetor/index.js`):

```ts
class S extends Carburetor<{item: {a: number; b: number}}> {
    edit(key: 'a' | 'b', value: number) { this.update(d => { d.item[key] = value; }); }
}
const s = new S({item: {a: 1, b: 1}});
const seen: Array<{a: number; b: number}> = [];
const stop = s.watch(d => d.item, next => seen.push({...next}));
s.edit('a', 2);
s.edit('b', 2);
console.log({raw: s.getData(), seen, version: s.getVersion()});
stop();
```

Observed source and packed output: `raw.item={a:2,b:2}`, `seen=[{a:2,b:1}]`, `version=2`. Expected `seen` to include `{a:2,b:2}` after the second write. **Remedy:** finalize/detach the selection's complete reads before filing its new subscription, or explicitly file newly discovered read paths before returning. Keep the rule that equal-content selectors still re-file changed conditional dependencies; do not mask the missing callback by broadening subscriptions to wildcard.

## R21-ENG-02 — equal-content replacement does not invalidate native alias ownership

**Mechanism.** The write proxy installs a different plain object on an existing key, then `diffPaths` determines which value paths changed (`lib/src/Carburetor/Store/Tracking/createWriteProxy.ts:355-427`). Equal old/new enumerable content produces an empty changed set (`Store/Paths/Diff/diffPaths.ts:65-110`); no path reaches the store's `writeRecorder`, the only ordinary draft-write invalidation of the root-owned `nativeAliasIndex` (`Store/Carburetor.ts:84-88`). But root ownership tracks **raw object identity**, not only enumerable content (`Store/Tracking/Aliases/NativeAliasIndex.ts:4-32`): its cached map still links the previous plain object to the ordinary path and has no path for the new object, although that same new object is already a native Map member. A subsequent `Map.get` read returns the *new* raw member but `recordNativeAliasReads` finds no ordinary alias (`Store/Tracking/Aliases/NativeAliasReads.ts:14-55`); the Map path does not intersect a subsequent write to the ordinary leaf. The documented native/plain alias case (`README.md:882-888`) is the reason raw native members are deliberately exposed and tracked via ordinary writable paths. This is not an unsupported plain-tree diamond: the only sharing is between an ordinary field and a Map member.

**Executed actual-source public probe** (also repeated with Node's packed CJS output):

```ts
class S extends Carburetor<{row: {id: number}; map: Map<string, {id: number}>}> {
    edit(change: (draft: {row: {id: number}; map: Map<string, {id: number}>}) => void) {
        this.update(change);
    }
}
const old = {id: 1}, newer = {id: 1};
const s = new S({row: old, map: new Map([['old', old], ['new', newer]])});
const seed = s.watch(d => d.map.get('old')?.id, () => {}); // builds root index
s.edit(d => { d.row = newer; }); // content equal, ownership different
const seen: number[] = [];
const stop = s.watch(d => d.map.get('new')?.id, value => seen.push(value));
s.edit(d => { d.row.id = 2; });
console.log({newAlias: s.getData().map.get('new') === s.getData().row,
    value: s.getData().map.get('new')?.id, seen, version: s.getVersion()});
stop(); seed();
```

Observed source: `newAlias:true`, `value:2`, `seen:[]`, `version:1`; the packed output likewise had `nativeSeen:[]`, raw `2`, version `1`. Expected the second watch callback to receive `2`. A bounded control *without the prior Map read* built its index only after the replacement and did receive `seen:[2]`, isolating stale ownership rather than a general Map receiver/watcher failure. **Remedy:** invalidate the root-owned native alias index whenever a draft write actually changes a plain branch's raw identity, including equal-content replacements with no published value path; preserve the existing no-op notification and leaf precision when values are equal. This invalidation must not rely solely on `recordWrite`.

## Inspected breadth, controls and limits

- **Read/write/cache/ownership.** Examined `Carburetor` read/draft/setData/restore/emit and watch boundaries, read and write proxy traps, per-tree branch caches, read-only native facades and their receiver/canonical key normalization, native member exposure and root index invalidation, development alias/state validation, escaped/native class leaves, descriptors and raw identity. Distinguished state descriptors from selection descriptors: an enumerable ordinary primitive property's writable-only change can be installed through `setData`, but the documented ordinary container *state* is its enumerable keys and values (`README.md:893-901`; `deepClone.ts:8-10,48-65` normalizes ordinary flags). Descriptor-only introspection is explicitly not a value dependency (`Models/Store.ts:9-12,109-110`). Accordingly that observed flag-only no-publication case is **not counted** as another finding. Array `length` flags are a separately supported transition and have explicit handling in `diffPaths` and `setArrayLength`.
- **Paths, arrays and partial failure.** Examined key-set/branch markers, escaping and ancestor indexes, read-set transfer, write-log watermark, numeric-vs-insertion-ordered key rules, array growth/shrink and non-configurable tail attribution, same-kind diff, patch installation, ordered replay eligibility, `applyDiff` nested order preflight and threshold fallback. An actual-source control deleted the first of two ordinary row keys, then undid/redid through history and restored reordered keys. Observed key orders `['b']` → `['a','b']` → `['b']` → `['b','a']`, four appropriate watch notifications and version `4`. This does not establish every sparse-array or failure-injection combination.
- **Transactions, generations, Computed and scheduling.** Examined nested batch draining and wave settling, subscriber generations, synchronous and throttle cancellation/reentrant rounds, computed dependency attachment and rollback, leaf-version drift, unobserved snapshot revision, announcement baselines, disposal and external-source bridge, and read tracking. An actual-source transaction changed two stores from `1+2` to `2+3`: a subscribed computed announced `5` once at the transaction boundary, read back `5`, and announced `4` when one history later undid the first store. A separate bounded throttled control called `clear()` on one of two independent histories between `a` and `b` writes; after flush that history undid only `b`, leaving `a=2`, while the second recorder still had undo available. No additional fault was established there.
- **History and cross-module.** Examined owned complete native graphs/descriptors/backlinks, alias topology equality, patch fast path vs opaque snapshots, pending/clear/canceled publication, replay cursor on failure, replay adoption for key order/length locks, branching and independent patch observer fanout. A bounded actual supplied-packed-output Node control used a CJS `Carburetor` and ESM `CarburetorHistory`; setting an existing Map key with the CJS draft proxy normalized the key and ESM history undid it: `changed:'two'`, `undone:true`, `after:'one'`, `sameKey:true`. Development printed duplicate-format diagnostics as documented. This is one supported cross-format path, not a claim about all bundlers or versions.

The two findings are actual consumer-visible missed updates, not inferred warnings. No project-wide validation, React render/browser test, exhaustive graph/transaction matrix or performance measurement was run as part of this isolated report; source inspection and bounded controls do not certify other paths defect-free.

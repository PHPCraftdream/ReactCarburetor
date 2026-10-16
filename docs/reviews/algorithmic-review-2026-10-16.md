# Algorithmic complexity review — 2026-10-16

Branch `master`, HEAD `f124880`. Read-only review: no code was changed, no test, benchmark, build
or binary was run for this report. Every timing statement below is therefore an estimate unless it
quotes a number already recorded in the source or the perf README.

## Scope

Structural and asymptotic wins only (allocation-level and constant-factor tuning belongs to the
concurrent micro-performance review). Areas read:

- `lib/src/Carburetor/Store` — path tracking (`Paths/SubscriberIndex.ts`, `Paths/WriteLog.ts`,
  `Paths/Markers/readCoverage.ts`), write path and notification fan-out
  (`Transaction/emitStoreUpdate.ts`, `Transaction/UpdateBatch.ts`, `Carburetor.ts`,
  `Scheduling/*`), write proxy and positional array attribution (`Tracking/createWriteProxy.ts`,
  `Tracking/Proxy/Positional/*`), native alias index (`Tracking/Aliases/*`), structural diff
  (`Paths/Diff/*`), selection reconciliation and patching (`Utils/Selection/**`,
  `Component/Connection/sameSelection.ts`).
- `lib/src/Carburetor/Derived` — computed dependency tracking, freshness, invalidation, wave
  settlement.
- `lib/src/Carburetor/Tooling` — history record/undo/redo and fold/preflight helpers, persist,
  devtools.
- `lib/src/Carburetor/Resource/Cache` — eviction ledger/LRU, primitive key memo, removal,
  invalidation.
- `lib/src/Carburetor/Component/AntiHookComponent/Subscriptions.tsx` — commit-time subscription
  alignment and drift check.
- `native/src` — walker, rule registry, semantic builds, per-rule traversals, suppression,
  diagnostic location, `--fix` loop.

## Method

1. Read each hot structure end to end and wrote down its cost in terms of the sizes that matter:
   N state nodes / entries, S subscribers, P written paths per publication, D path depth,
   R read-set size, K keys in one container, F computed fan-in, L history limit; for the linter,
   N AST nodes, D_f function-nesting depth, S source bytes, Dg diagnostics.
2. For each, looked for the input shape that makes it bite and checked whether an existing gate in
   `perf/gates/*.mjs` (ids listed via `id:` fields) or a scenario in `perf/scenarios/**` exercises
   that shape.
3. Marked each claim **OBSERVED** (follows directly from the code as read) or **INFERRED**
   (depends on runtime behaviour or on a speedup estimate that was not measured).

Findings are ranked by impact/effort. Priority: **P1** — large and likely to bite real users;
**P2** — clear asymptotic gap on a plausible shape; **P3** — worth doing opportunistically.

## Already sound (checked, no finding)

Listed so the next review does not re-derive them:

- `SubscriberIndex.match` — exact/branch maps, O(P·D) lookups plus output size; multi-write
  dedup of shared exact buckets. `hasReaderAt` O(1). Covered by `subscribe/match-precision@*`,
  `subscribe/refile-delta@*`, `subscribers/filing@*`.
- `SubscriberIndex.add` re-registration diffs old vs new read set: O(R) membership + O(Δ·D).
- `WriteLog.matches` is O(R·D) independent of how many writes landed (path-indexed, not a list).
- `EvictionLedger` — O(1) count, LRU walk stops at `excess`, doubling hysteresis on fruitless
  scans (amortised O(final size)). Primitive key memo: Map + intrusive LRU list, O(1).
- `UpdateWave` coalesces settlements by uid; diamond graphs settle each node once (deferral is
  replaced, pulls are version-checked).
- `readCoverage.prune` — O(R·D) prefix set, scan budget for `impliedBy`.
- `ArrayIdentity` — few-differences scan, Sets only past 8 differing positions.
- `patchFromWriteLog` / `planSelectionPatch` — selection patching relative to selection size
  (R36-01/R37-04); raw-target ledger proof for outside-root writes.
- `Computed.markStale` is monotone (stops at an already-invalid node), so invalidation is
  amortised O(edges).

## Findings

### ALGO-01 — Linter: ~31 full-tree traversals per file at default config (P1)

**Status:** OBSERVED (pass count), INFERRED (speedup).

**Where:** `native/src/rules/mod.rs` `run` (lines 196–273) and `REGISTRY`;
`native/src/rules/support/walk.rs` `walk_rule` (415–427); `build_semantic` in
`native/src/rules/support/closures/mod.rs` (64–69) called again from
`allocations/no_closure_in_update.rs:238`, `boundaries/no_async_transaction.rs:201`,
`effects/no_async_effect.rs:111` (and `allocations/no_react_hooks_in_components.rs:377` when
enabled).

**Current cost:** with the default severity table (25 of 27 rules on) one file costs:

| Pass kind | Count |
|---|---:|
| Parse | 1 |
| `SemanticBuilder` with node table (shared allocation pair + no-closure-in-update + no-async-transaction + no-async-effect) | 4 |
| `walk_rule` traversals (one `Walk` per rule; 16 rules use it) | 16 |
| Rule-local `visit_program` traversals (9 rules) | 9 |
| `require-module-function` `ModuleScan` | 1 |
| **Total full traversals** | **~31** |

That is O(31·N) per file before counting the per-member sub-walks of ALGO-02. Every `walk_rule`
traversal maintains the identical `Context` (class/member/render/update/JSX bookkeeping), so 15
of the 16 rebuild state that is already known. `--fix` multiplies the whole thing by up to
`MAX_FIX_PASSES + 1 = 11` (`native/src/main.rs:43`, `stabilize` 315–345).

**Bites on:** every file of every consumer CI run — the stated purpose of the binary
(`main.rs` header).

**Redesign:**
1. Build `Semantic` once per file in `rules::run` and pass `&Semantic` to every rule that needs
   one (the shared-allocation pattern already exists for two rules; extend it to the other
   three/four).
2. Replace per-rule `walk_rule` with one multiplexed walk: `Walk` holds the enabled rules
   (a fixed array of `Option<RuleState>` or a small `Vec<&mut dyn Rule>`) and fans each hook out
   to them with the shared `Context`. Disabled rules are simply absent, preserving "off makes it
   cheaper".
3. Port the 9 `visit_program` rules onto `Rule` hooks where their state allows (most track class
   and member context the walker already maintains); keep a dedicated pass only for rules that
   genuinely need a different traversal order.

**Target:** 1 parse + 1 semantic + 1–3 walks ≈ O(3–5·N).

**Expected speedup:** INFERRED 3–6x per-file analysis time (semantic builds are the most
expensive passes; four become one). Larger under `--fix`.

**Risks:** diagnostic order (currently registry order, then the H31/H32 dedup) must be preserved
— collect per rule into separate vectors and concatenate in registry order. Rules that
early-return or skip subtrees (`visit_class` no-ops in closure scans) cannot share the walk and
must stay separate. Conformance corpus guards behaviour.

**Coverage:** no native perf gate exists; behaviour covered by `native/tests/cli.rs`, in-file
unit tests and the JS/native conformance corpus. A gate (files/second on a fixed corpus, or a
pass counter emitted under a test feature) should land with the change.

**Effort:** M–L.

---

### ALGO-02 — Linter: nested-function capture analysis is O(N·D_f), and runs twice per member (P1)

**Status:** OBSERVED.

**Where:**
- `native/src/rules/allocations/require_module_function/module_functions.rs`
  `ModuleScan::visit_function` (243–289) and `visit_arrow_function_expression` (291–332): for
  **every** function/arrow after its own walk it clones the enclosing-span stack (O(d)), runs
  `has_class_dependency` / `arrow_has_class_dependency` (a full `DependencyScan` of the function
  subtree, `support/closures/mod.rs` 35–62, computed before the `clean` short-circuit), walks
  `ancestor_kinds` (O(d)), and for clean candidates runs a full `CaptureProbe` of the subtree
  whose per-identifier check is `enclosing.iter().any(...)` (O(d)).
- `native/src/rules/support/closures/collect.rs` `collect_site` (53–71): per closure site, two
  more full sub-walks (`captures` → `CaptureCollector`, `depends_on_class` → `DependencyScan`)
  plus `usage` doing a linear `declarators.iter().find(...)` (122–128).
- `analyze_method` / `analyze_field` (Scan walk + Collect walk + `member_class_dependency` walk)
  are invoked independently by both allocation rules for the same member:
  `require_method_for_closure.rs:193/206` and `require_module_function.rs:262/275`.

**Current cost:** Σ over functions of subtree size = O(N·D_f), with an O(N·D_f²) term from the
`enclosing` scan; `usage` adds O(sites × declarators) per member; member analysis is done 2x.

**Bites on:** deeply nested callback code — promise chains, JSX render props, test files with
`describe`/`it`/`act` nesting, event-handler factories. Depth 8–10 is ordinary in test suites.

**Redesign:** one post-order pass over the shared semantic:
- Precompute function depth per scope once (`scope → depth`, O(scopes)).
- For each identifier reference that resolves to a symbol declared at function depth `d ≥ 1`
  (module level is `d = 0`), fold `d` into the current frame's `min_decl_depth`; on frame exit
  propagate `min(child, parent)` upward. A frame at depth `k` captures an enclosing function's
  binding iff `min_decl_depth < k` (references declared inside the frame have `d ≥ k`). O(1) per
  reference.
- Do the same bottom-up propagation for the class-dependency facts (`this`/`super`/private
  names/class type parameters) and for the dynamic `this`/`arguments` mark (propagate until the
  first non-arrow frame) instead of `mark_dynamic`'s stack walk.
- Index declarators by init span (`HashMap<Span, Declarator>`) for `usage`.
- Compute `MemberAnalysis` once per member and hand it to both allocation rules (cache keyed by
  member span inside the shared run, or make the pair one rule internally with two outputs).

**Target:** O(N) per file for capture/dependency facts; member analysis once.

**Expected speedup:** INFERRED roughly proportional to nesting depth on the affected rules
(5–20x on deeply nested files), plus 2x from removing the duplicate member analysis.

**Risks:** capture semantics have many carve-outs (own symbol, type-only references, written
after init, this-derived). Each needs a propagated equivalent; the existing unit tests under
`require_module_function/tests/*` and `support/closures/tests/*` are the oracle.

**Coverage:** behaviour only (unit tests, conformance corpus); no performance guard.

**Effort:** M.

---

### ALGO-03 — History: deleting a non-last string key costs O(container) per delete and O(state) per publication (P1)

**Status:** OBSERVED.

**Where:**
- `Store/Tracking/createWriteProxy.ts` `deleteProperty` (530–571) calls
  `keyDeletionRequiresReplay(source, key)` whenever a patch listener is attached (540–541).
  `Store/Paths/Diff/Order/keyDeletionRequiresReplay.ts` (8–16) runs `Object.keys(source)` and
  `indexOf` — O(K) per delete.
- When it answers true (any ordered string key after the deleted one — i.e. almost every
  dictionary deletion except the last key), the proxy emits `PATCH_KEY_ORDER_CHANGE`.
  `Tooling/CarburetorHistory.ts` `onPatch` (273–277) turns that into `markPendingOpaque()`,
  so `buildEntry` takes `buildSnapshotEntry` (498–522): a full `capture()` clone O(N), a full
  `sameHistoryGraph` compare O(N), and an entry holding full `before`/`after` states.
- Same mechanism on the diff path: `Paths/Diff/diffPaths.ts` `walkObject` (114–118) emits
  `PATCH_KEY_ORDER_CHANGE` for any non-appendable key-order change, so `setData`/`restore` that
  removes a middle key also degrades to a snapshot entry.
- Bulk removal deletes key by key: `Resource/Cache/State/Mutation/removeCacheEntries.ts`
  (26–37), reached from `ResourceCacheState.clear` (328–356) and `evict` (413–419).

**Current cost:**
- One `delete draft.byId[id]` in a history-tracked store: O(K) key scan + O(N_state) capture +
  O(N_state) compare, and O(N_state) memory per history entry (×`limit`, default 50).
- K deletions in one publication (cache `clear()`, eviction of K victims, "remove completed"
  over a normalized dictionary): O(K·K_container) key scans — the `PATCH_KEY_ORDER_CHANGE`
  check is computed in the proxy before history has a chance to ignore it — then one O(N)
  snapshot.
- Undo of such an entry replays a snapshot (own + restore) at O(N_state) instead of O(patches).

**Bites on:** normalized `byId` dictionaries and `ResourceCache.entries` with
`CarburetorHistory` (or any patch observer) attached. Example: clearing a 10k-entry cache under
history is ~5·10^7 key copies before the snapshot.

**Redesign:**
1. Make key position part of the deletion patch instead of an "opaque" verdict: the inverse of
   a middle deletion reinstalls the key and then re-appends the ordered string keys that
   followed it (delete + redefine each), O(K_container) **at undo time only**, scoped to that
   container.
2. Compute the successor lazily: history already owns a baseline mirror whose key order is the
   pre-publication order; resolve "what followed this key" in `buildEntry` from the baseline
   container (O(K_container) once per entry, not per delete), so the proxy no longer needs
   `keyDeletionRequiresReplay` on the hot path. Where the proxy must decide, skip the scan once
   the batch is already opaque (`patchPort.opaque`) or the observer has gone opaque.
3. Apply the same position-carrying patch to `walkObject`'s reorder case where the change is a
   pure set of middle deletions.

**Target:** O(1) per delete on the write path; O(K_container) per entry at record time;
O(patches + K_container) undo; O(Δ) memory per entry.

**Expected speedup:** O(N_state)/O(Δ) per affected publication — 3–4 orders of magnitude on a
10k-node state for a single-key delete; quadratic-to-linear on bulk deletion.

**Risks:** key-order fidelity is a documented guarantee (R16 era); the reinsert-and-reappend
inverse must reproduce exact `Object.keys` order including integer-like keys (which enumerate
numerically regardless) and `__proto__` own keys. Locked/non-configurable descriptors still need
the owned-endpoint path.

**Coverage:** none for this shape. `state/resource-history*` covers history over a resource
cache but performs no deletions; `cache/forget-all@*` measures bulk removal without history;
`history44/structural-markers` checks marker semantics, not cost.

**Effort:** M.

---

### ALGO-04 — Positional array methods copy and compare the whole array for any range (P2)

**Status:** OBSERVED.

**Where:** `Store/Tracking/Proxy/Positional/positionalArrayMethods.ts` `runPositional`
(156–170) takes `source.slice()` before every intercepted call, and `attributePositional`
(64–110) compares every index `0..max(before, after)`. Intercepted set:
`createWriteProxy.ts:42–44` (`sort`, `reverse`, `splice`, `shift`, `unshift`, `copyWithin`,
`fill`).

**Current cost:** O(N) per call regardless of how many slots change. K calls in one update:
O(K·N).

**Bites on:** `splice(length - 1, 1)`, `splice(i, 1, replacement)`, `fill(v, a, b)` on a small
window, `copyWithin` of a short range, and loops removing several items by `splice` from a large
array (100k-row tables, logs, chat buffers).

**Redesign:** derive the affected window from the arguments before the native call:
- `splice(start, deleteCount, ...items)`: `[start, start + items.length)` when
  `deleteCount === items.length`, otherwise `[start, max(oldLength, newLength))`;
- `fill(v, s, e)`: `[s, e)`; `copyWithin(t, s, e)`: `[t, t + (e - s))`;
- `shift`/`unshift`/`sort`/`reverse`: whole array (unchanged).

Slice and compare only that window (sparse arrays keep the current own-key handling).

**Target:** O(window) per call; tail splices O(1).

**Expected speedup:** N/window — 10^3–10^4x for tail edits on 10k–100k arrays; no change for
head edits (inherent: every index moves).

**Risks:** argument normalisation must follow the spec exactly (negative indices, `undefined`
deleteCount, clamping, `ToIntegerOrInfinity`); a wrong window silently drops write paths. Use
the native result (`source.length`, removed array length) to cross-check the computed window.

**Coverage:** `array/positional@10k`, `array/positional@10k-subs` (measure positional
attribution; do not isolate tail-window calls).

**Effort:** S.

---

### ALGO-05 — History fold search is O(P²) once an owned object target is pending (P2)

**Status:** OBSERVED (complexity), INFERRED (frequency).

**Where:** `Tooling/Graph/foldDependentPatch.ts` (18–45), called from
`CarburetorHistory.onPatch` for every scalar patch (288) and object patch (311) whenever
`pendingPossibleOwnedTarget` is set; the flag is raised by any pending patch whose owned `next`
is trackable (313) and stays up until the publication closes.

**Current cost:** each new patch scans all pending patches from the end (O(P)); a prefix match
additionally runs `patches.slice(index + 1).some(...)` (O(P) allocation + O(P·D) compare).
Per publication: O(P²·D).

**Bites on:** one update/transaction that inserts an object and then performs many writes —
e.g. "add row, then recompute `done` for every row", import/normalize loops, a manual-throttle
batch. The R43-S02 work removed the search for scalar-only batches; the owned-target case still
scans.

**Redesign:** keep a path trie (or `Map<joinedPrefix, index>`) of pending patches with trackable
owned `next`, plus the latest index written at or above each node. Folding a patch looks up its
ancestor chain (O(D)), and the "intermediate patch owns the subtree" test becomes a comparison
of the ancestor's index with the max index recorded on the chain below it.

**Target:** O(D) per patch, O(P·D) per publication.

**Expected speedup:** P/D — ~100–1000x for P = 1k–10k pending writes.

**Risks:** fold order semantics (later patch wins, intermediate owner blocks) must be preserved
exactly; replacing a pending entry (`patches[index] = {...}`) must update the trie.

**Coverage:** `history43/scalar-batch@*` and `history43/timing@*` cover scalar fold-search work
(and `ownedTargetCorrect` as a correctness flag), `history/r33-patches@10k` covers overlapping
object patches; none scales P with a pending owned target.

**Effort:** S–M.

---

### ALGO-06 — Structural selection changes always take the full O(selected nodes) reconcile (P2)

**Status:** OBSERVED (fallback), INFERRED (speedup).

**Where:** `Store/Utils/Selection/Patch/planSelectionPatch.ts` returns `undefined` for any
`~k`, `~p` or `length` segment (line with `segment === '~k' || ... 'length'`), so
`patchFromWriteLog` falls back to `reconcileSelection`, whose `reconcileArray`
(`reconcileSelection.ts` 278–399) descends into every member via `reconcileKeyed`
(157–253): O(total selected nodes), not O(changed rows).

**Current cost:** appending one row to a 10k-row selection, popping one, or adding one key to a
selected dictionary costs a full deep compare of every row for every consumer selecting the
collection (`watch`, `useCarburetorValue`, resource readers, connections).

**Bites on:** list views selecting the whole collection (the common case), chat/log append,
infinite scroll.

**Redesign:** extend the existing raw-target proof (already used for outside-root writes in
`patchFromWriteLog` 66–87) to structural changes of the selected container itself:
- If every written raw target since the baseline is either the selected container or not in the
  copy ledger, then no member container changed in place.
- Then: shallow-copy the previous array/object (pointer copy, O(N) but no descent), reuse each
  member's previous copy by raw identity from the ledger (O(1) per member, handles moves from
  `splice`/`unshift`), detach only members with no ledger copy (new rows), and drop vanished
  ones.
- Append/truncate without moves is the simplest first step (plan `length` + new indices).

**Target:** O(N) pointer copy + O(Δ · row size) instead of O(N · row size); O(Δ) when only
appends are allowed to reuse the previous array's prefix by copy-on-write.

**Expected speedup:** ~row size (5–50x) per consumer per structural write on wide rows.

**Risks:** the ledger must cover every container the snapshot includes (it does for detached
selections per the R36/R39 design); cyclic/shared graphs keep the full path (`trace.shared`
already gates patching). Topology checks (`previousToFresh`) must still detect a row now
appearing twice.

**Coverage:** `selection37/patch-budget@4k`, `selection36/related-walk@*`,
`selection36/memo-moves@2k` touch the area; none measures an append or pop on a large
selection.

**Effort:** M.

---

### ALGO-07 — persist re-serializes the whole state on every flush (P2)

**Status:** OBSERVED.

**Where:** `Tooling/persist.ts` — `write` (61–74) runs `JSON.stringify(carburetor)` (whole wire
form) and `storage.setItem`; coalescing (96–112) is one flush per microtask.

**Current cost:** O(N) traversal + O(bytes) storage write per flush, independent of how much
changed. Writes arriving in separate ticks (typing, drag, sockets) each pay a full flush.

**Bites on:** large persisted stores with frequent small edits (form state next to a big cached
list, offline-first todo/CRM apps): every keystroke re-serializes and rewrites the whole store.

**Redesign (two independent steps):**
1. Frequency bound: optional time/idle-based coalescing (`flushAfterMs` or
   `requestIdleCallback`) — O(N × flushes/s) instead of O(N × writes-in-distinct-ticks/s); the
   disposer already flushes drift, so durability on teardown is unchanged.
2. Partitioned storage (opt-in): one storage key per top-level branch (or per configured
   partition path), one `subscribe` with `reads: {branch}` per partition, re-stringify and write
   only dirty partitions. Valid only for the base `toJSON` (custom wire forms such as
   `ResourceCache` keep the whole-store path).

**Target:** O(dirty partition) per flush; flush rate bounded by configuration.

**Expected speedup:** INFERRED 5–50x for multi-branch states; nothing for a single giant branch
(partitioning below the first level would need fragment caching driven by write paths, which is
a larger design).

**Risks:** new public options (surface area); storage layout change needs a migration/compat
read of the legacy single key; atomicity across partitions is weaker (a crash between two
`setItem`s leaves mixed versions — acceptable only with a version stamp per partition).

**Coverage:** `store/r33-persist@10k` (whole-store serialization cost).

**Effort:** M (step 1 S).

---

### ALGO-08 — Linter: no text prefilter for marker-dependent rules (P2)

**Status:** OBSERVED (prefilter is test-only), INFERRED (fraction of skippable files).

**Where:** `native/src/rules/mod.rs` `may_contain_component_base` (182–188) exists only under
`#[cfg(test)]`; `run` parses and traverses every file with every enabled rule.

**Current cost:** all ALGO-01 passes on files that cannot contain a finding for most rules:
plain utilities, types, constants, API clients with no component/carburetor class and no
library import.

**Redesign:** group rules by the textual markers they need (component bases, carburetor bases,
`update(`/`emitUpdate`/`draft`, `useCarburetor`/`useComputed`/`transaction` imports, effect
APIs) and skip a group when none of its markers occurs in the source text (one
`memchr`/Aho-Corasick scan, O(S)). Keep the existing escape hatch: a backslash in the source
(escaped identifiers) disables the prefilter. Rules with module-wide scope
(`require-module-function` at `scope: "all"`) are never prefiltered.

**Target:** O(S) scan + only the passes a file can trigger; for marker-free files: parse +
semantic + module-function scan.

**Expected speedup:** INFERRED 2–5x on typical consumer trees where most files are not
components or stores; multiplies with ALGO-01.

**Risks:** false negatives if a rule's real trigger is broader than its marker list (re-exported
or aliased bases from another module are already out of scope for per-file rules, but each rule
must be audited); the conformance corpus must include marker-free files that still report.

**Coverage:** none (performance); `allocation_prefilter_*` unit tests show the previous
prefilter's contract.

**Effort:** S–M.

---

### ALGO-09 — diffPaths overflow path walks the same trees up to four times (P3)

**Status:** OBSERVED.

**Where:** `Store/Paths/Diff/diffPaths.ts` (284–331): the first walk aborts at
`DIFF_PATH_THRESHOLD` (2000) recorded paths; then `countDiffLeaves.changed` and
`countDiffLeaves.total` (`Threshold/countDiffLeaves.ts`) walk again; a non-collapsing verdict
re-walks precisely with an unlimited budget; a same-kind root collapse additionally runs
`countDiffLeaves.changed` per top-level key. `applyDiff.ts` has the analogous
`countChanges`/`countLeaves` pre-passes.

**Current cost:** 3–4 × O(diff size) on every large `setData`/`restore`/branch replacement past
2000 changed paths.

**Redesign:** single walk that records paths (and patches) into a buffer while counting both
changed and visited leaves, never throwing; decide collapse vs precise at the end and either
keep the buffer or discard it in favour of the collapsed path. Positional/sparse handling is
shared with the existing walk.

**Target:** 1 × O(diff size) (+ buffer memory bounded by the diff, which the precise path holds
anyway).

**Expected speedup:** 2–3x on large replacements near or above the threshold.

**Risks:** the abort currently also caps memory for near-total replacements; the fused walk
must stop recording patches once `changed > threshold && changed > visited/2` is already
certain, to keep the collapse case cheap.

**Coverage:** `replace36/relative-diff@10k`, `replace36/public-replacements@10k`,
`diff39/genuine-leaves@5k`, `store/restore-one-leaf@*`.

**Effort:** S–M.

---

### ALGO-10 — WriteLog forgets everything at capacity instead of evicting the oldest (P3)

**Status:** OBSERVED (mechanism), INFERRED (render impact).

**Where:** `Store/Paths/WriteLog.ts` `record` (95–135): once `last.size + under.size` exceeds
8192 it clears both maps and raises `watermark` to the **current** version; `matches` then
answers `true` (coarse) for every baseline below it.

**Current cost:** every render attempt whose baseline predates the reset loses path precision at
commit (`Subscriptions.alignSubscription` → `CARBURETOR_HAS_DRIFT` → `matches`), producing
spurious force-updates; under steady wide writes the reset recurs every ~4000 distinct rows.

**Redesign:** keep `last`/`under` in version order (Map delete-then-set on every update, as
`EvictionLedger.touch` does) and evict from the oldest end; set `watermark` to the version of
the newest evicted entry. Baselines newer than that stay precise.

**Target:** same O(1) amortised per indexed path; precision lost only for baselines older than
the evicted horizon rather than for everything before "now".

**Expected speedup:** removes O(pending commits) spurious renders per reset burst; no change in
asymptotic write cost.

**Risks:** the raw-target and recent-path trackers reset together with the log today; they need
the same horizon semantics (or keep their own reset on overflow).

**Coverage:** `drift36/log-reset@10k`, `drift36/related-writes@10k`, `writelog39/*`.

**Effort:** S.

---

### ALGO-11 — Linter: `locate` is O(offset) per diagnostic (P3)

**Status:** OBSERVED.

**Where:** `native/src/rules/mod.rs` `locate` (135–146) counts `\n` from the file start for
every diagnostic (`report_with_fix`, 157–176) and counts chars of the last line;
`suppression.rs:118` uses it per directive.

**Current cost:** O(Dg · S) per file.

**Bites on:** first adoption runs and generated/large files with hundreds to thousands of
warnings (`no-function-in-render`, `require-module-function` at `scope: "all"`).

**Redesign:** build a line-start table once per file (lazily on the first diagnostic) and
binary-search it; compute the column from the line start (char count of a short slice).

**Target:** O(S + Dg · log lines).

**Expected speedup:** Dg-fold on heavy files; negligible on clean ones.

**Risks:** none beyond column semantics (chars, not bytes) — keep `chars().count()` on the
line-prefix slice.

**Coverage:** none.

**Effort:** S.

---

### ALGO-12 — Native alias answers are invalidated store-wide on any topology change (P3)

**Status:** OBSERVED (mechanism), INFERRED (frequency).

**Where:** `Store/Tracking/Aliases/NativeAliasIndex.ts` `noteChange` bumps the root generation
unconditionally (first statement), and positional methods / truncation call `invalidate`
(drop the whole ownership index). `NativeAliasReads.ts` (47–58) trusts a cached answer only at
the same generation; a miss re-walks the native member's graph (71–95) and, after an
invalidation, rebuilds the root ownership index with `buildOwnershipIndex` — O(N state).

**Current cost:** in a store that exposes Map/Set/Date/class members holding plain objects, any
container add/replace/delete anywhere (e.g. pushing a row) makes the next read of every such
native re-walk it, and positional edits force an O(N) index rebuild on the next native read.

**Redesign:** scope invalidation to what changed: `noteChange` already computes the old and new
subtree ownership (`oldPaths`/`newPaths`); bump per-object generations for those objects only
and validate a cached answer against the generations of its own `exposed` set. Positional
moves can update paths for the moved occupants (their old/new indices are known in
`attributePositional`) instead of dropping the index.

**Target:** O(changed subtree) per topology change; cached native answers survive unrelated
writes.

**Expected speedup:** O(N)/O(Δ) on native-heavy stores with frequent structural writes.

**Risks:** the documented contract "in-place mutation of a native is picked up after the next
topological write" currently relies on the global bump; narrowing it changes when such
mutations are seen. Needs an explicit decision before implementation.

**Coverage:** `aliases43/precision`, `aliases43/retired-root*`, `alias39/truncate-invalidates@64`,
`aliases/read-cache@10k`.

**Effort:** M.

---

### ALGO-13 — Observed fan-in computeds re-probe every part after any write anywhere (P3)

**Status:** OBSERVED (mechanism), INFERRED (cost and safe conditions).

**Where:** `Derived/Computed.ts` `hasDrifted` (237–251): the fast path holds only while the
**global** `nativeStoreWriteEpoch` is unchanged (bumped by every emit of every store,
`emitStoreUpdate.ts:64`). Otherwise `leafVersionsDrifted` iterates every leaf, and a fan-in
leaf iterates every `part` (`Freshness/leafVersionsDrifted.ts`), each calling
`CARBURETOR_HAS_DRIFT`. `captureLeafVersions` merges F inner read sets into F parts.

**Current cost:** O(F) probes per `get()`/settle of an observed fan-in computed after any write
to any store, even when push invalidation already proved nothing relevant changed.

**Redesign:** for an *observed* computed, validity is maintained by push (`markStale` runs
synchronously in `onDependencyChanged`). The pull check is needed only when a notification can
be outstanding: an open `UpdateBatch` transaction, or a leaf store whose scheduler defers
delivery (throttle). Track a per-computed "all leaves deliver synchronously" bit and skip the
probe when it holds, the computed is valid and observed, and no batch is active.

**Target:** O(1) for the common synchronous case; unchanged otherwise.

**Expected speedup:** F-fold on the read path of large fan-in computeds (F = 1k–10k item
computeds).

**Risks:** high — the drift path guards several subtle cases (mid-wave pulls, throttled
delivery, unobserved-to-observed transitions, external sources). Needs the computed41–44 gate
families and the derived/r32–r33 controls green before and after.

**Coverage:** `derived/drift-fan-in@10k`, `derived/r32-fan-in@1600`, `computed42/*fan-in*`,
`computed42/merged-pair-freshness`.

**Effort:** M.

---

### ALGO-14 — History snapshot entries cost O(state) memory each; `past.shift()` is O(L) (P3)

**Status:** OBSERVED.

**Where:** `Tooling/CarburetorHistory.ts` `buildSnapshotEntry` (498–522) stores whole
`before`/`after` graphs; `record` trims with `this.past.shift()` (376–378).
`Tooling/connectDevTools.ts` (37–54) likewise deep-clones (`snapshot()`) the changed store per
update.

**Current cost:** opaque publications (native members, `markAllChanged`, ALGO-03 shapes) hold
O(N) per entry → O(L·N) memory; trimming is O(L) per record at the limit.

**Redesign:** the snapshot path already walks both graphs in `sameHistoryGraph`; turn that walk
into a structural diff and store the entry as owned patches when the graph is plain enough,
keeping full endpoints only for genuinely non-patchable transitions. Replace the `past` array
with a ring buffer (O(1) trim). For devtools, maintain a patch-advanced mirror like history's
baseline instead of a fresh deep clone per update.

**Target:** O(N + L·Δ) memory; O(1) trim.

**Expected speedup:** memory L-fold for opaque-heavy histories; trim cost negligible unless a
large `limit` is configured.

**Risks:** native/exotic endpoints and locked descriptors must keep the owned-endpoint path;
ring-buffer change must keep `canUndo`/`canRedo` and overflow semantics.

**Coverage:** `history44/after-opaque@*`, `history/mixed-capture@128`,
`contracts/devtools@500`.

**Effort:** M (ring buffer S).

## Summary

| ID | Title | Area | Current → target | Expected speedup | Priority | Effort | Gate / test coverage | Status |
|---|---|---|---|---|---|---|---|---|
| ALGO-01 | One semantic + one multiplexed walk | native linter | ~31·N → ~3–5·N per file | 3–6x (×11 under `--fix`) | P1 | M–L | none (cli tests, conformance) | OBSERVED / INFERRED |
| ALGO-02 | Bottom-up capture analysis, shared member analysis | native linter | O(N·D_f) (+O(N·D_f²)), 2x → O(N), 1x | 5–20x on nested files | P1 | M | none (unit tests) | OBSERVED |
| ALGO-03 | Position-carrying key deletion in history | history / write proxy | O(K) per delete + O(N_state) per publication → O(1) + O(K_container) per entry | 10^3x+ per delete on 10k state; quadratic → linear on bulk | P1 | M | none for deletions | OBSERVED |
| ALGO-04 | Windowed positional attribution | write proxy | O(N) per splice/fill/copyWithin → O(window) | N/window | P2 | S | `array/positional@10k*` | OBSERVED |
| ALGO-05 | Trie-indexed history fold | history | O(P²·D) → O(P·D) per publication | P/D | P2 | S–M | `history43/*` (no owned-target axis) | OBSERVED / INFERRED |
| ALGO-06 | Structural selection patch via ledger proof | selection | O(selected nodes) → O(N) pointer copy + O(Δ·row) | ~row size (5–50x) | P2 | M | `selection36/*`, `selection37/patch-budget` (no append case) | OBSERVED / INFERRED |
| ALGO-07 | Bounded-rate and partitioned persist | persist | O(N) per flush → O(dirty partition) | 5–50x (multi-branch) | P2 | M | `store/r33-persist@10k` | OBSERVED / INFERRED |
| ALGO-08 | Marker text prefilter per rule group | native linter | all passes on every file → O(S) scan + needed passes | 2–5x | P2 | S–M | none | OBSERVED / INFERRED |
| ALGO-09 | Fused diff overflow walk | structural diff | 3–4 walks → 1 walk | 2–3x | P3 | S–M | `replace36/*`, `diff39/genuine-leaves` | OBSERVED |
| ALGO-10 | LRU eviction in WriteLog | write log / commit drift | clear-all → evict-oldest horizon | fewer spurious renders | P3 | S | `drift36/*`, `writelog39/*` | OBSERVED / INFERRED |
| ALGO-11 | Line table for `locate` | native linter | O(Dg·S) → O(S + Dg·log L) | Dg-fold on heavy files | P3 | S | none | OBSERVED |
| ALGO-12 | Scoped native alias invalidation | alias index | O(N) rebuild / re-walk on any topology change → O(changed subtree) | O(N)/O(Δ) | P3 | M | `aliases43/*`, `alias39/*` | OBSERVED / INFERRED |
| ALGO-13 | Skip pull probes for synchronously observed computeds | computed | O(F) per get after any write → O(1) | F-fold | P3 | M | `derived/*fan-in*`, `computed42/*` | INFERRED |
| ALGO-14 | Diff-encoded snapshot entries, ring buffer | history / devtools | O(L·N) memory, O(L) trim → O(N + L·Δ), O(1) | L-fold memory | P3 | M | `history44/after-opaque`, `contracts/devtools@500` | OBSERVED |

Totals: **P1 — 3**, **P2 — 5**, **P3 — 6** (14 findings).

Suggested order: ALGO-04 and ALGO-11 first (small, isolated, spec-checkable), then ALGO-03
(largest user-visible cliff in the engine), ALGO-01 + ALGO-02 together (they touch the same
semantic plumbing), then ALGO-05, ALGO-06, ALGO-08. Every engine item should land with a gate
that fails on the pre-change build by mechanism (work counter), per `perf/README.md`.

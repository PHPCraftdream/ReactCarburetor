# Performance protection results — 2026-10-08

## Scope and method

Fresh measurements: **32 script pairs + 1 supplemental pair = 33 pairs**, **66 runner commands**, three samples per build/command. There are **71 entry/build comparisons, 65 distinct entry IDs** (the script alone: 69 comparisons, 63 IDs). Repeated prefixes (`store/r32-deep-clone`, `reads/proxy-alloc`) each received a fresh current run. All current commands passed: 71 selected entry occurrences, zero violations. Baselines: **47 failed / 24 passed entry occurrences, 110 violations**; 46/48 improvement-labelled occurrences failed, and 1/23 controls failed. These are overall runner counts, not counts of mechanism proofs.

Read the pair list with `cat ../pg-probes/baseline-pairs.sh`; did not execute it (its working-directory assumption is unsuitable here). For every pair, sequentially:

```sh
node perf/run.mjs --only <nonempty-prefix> --runs 3 --verbose --json <external-temp-report>
node perf/run.mjs --only <nonempty-prefix> --runs 3 --verbose --json <external-temp-report> --dist ../bench-dist/<sha12>/esm-prod
```

A read-only `node -e` coordinator used synchronous child spawning, continued after expected exit 1, and captured complete runner stdout/stderr plus JSON reports outside the repository. Evidence bundle identifier: `pg-measure-340-k2NMDP` (`verbose.log`, 66 per-command logs, 66 JSON reports, `pairs.json`); its private absolute location is supplied separately to the orchestrator. Measurement coordinator elapsed time: 25m27s. No rebuild, installation, git mutation, additional test suite, or lint run.

`--only` is substring matching: `components/ssr` includes `ssr-count`; `aliases/selection-visits` includes repeat; publication includes keys and its control. Entries sharing scenario/args/nodeArgs share samples within one command. Children use production mode and `--expose-gc`, plus entry-specific allowed Node flags. Baseline builds below mean `worktrees/bench-dist/<sha12>/esm-prod`.

Tables use **metric-specific** verdicts, not overall entry verdicts. Tuple values follow the metric order shown; a single exact value held across all three samples, otherwise values are runner medians with `[min–max]` or all boolean samples. `passes` means the listed gate(s) pass on baseline, not that an optimization is proven. Ungated counters are identified as diagnostics. Correctness, API availability, property verdicts, and heap/GC qualifications are explicitly distinguished from mechanism counters. Wall-clock measurements are not presented as mechanisms.

## #333 PG-C1 — quadratic work

| Entry | Finding label | Mechanism metric | Baseline build | Before | After | Verdict on baseline (fails/passes/API-missing) |
|---|---|---|---|---|---|---|
| cache/eviction-scaling@1k | JS-R16-04 | coldDictionaryCalls; coldDictionaryVisits; coldLedgerVisits; coldWork; coldWorkPerLoad | 9e4ef94c9188 | 2000; 1500500; 0; 1500500; 1500.50 | 0; 0; 1515; 1515; 1.51 | fails (calls/work; visit decomposition diagnostic) |
| cache/eviction-scaling@1k | JS-R16-04 | hitDictionaryCalls; hitDictionaryVisits; hitLedgerVisits; hitWork | 9e4ef94c9188 | 0; 0; 0; 0 | 0; 0; 0; 0 | passes |
| cache/eviction-scaling@1k-control | control | coldWork; probeDictionaryCalls; probeDictionaryVisits; probeLedgerVisits; idleDictionaryCalls; idleLedgerVisits; loaderCalls; hitLoaderCalls; remainingEntries | 9e4ef94c9188 | 1500500; 1; 1000; 1000; 0; 0; 1000; 0; 1000 | 1515; 1; 1000; 1000; 0; 0; 1000; 0; 1000 | passes |
| cache/eviction-scaling@4k | JS-R16-04 | coldDictionaryCalls; coldDictionaryVisits; coldLedgerVisits; coldWork; coldWorkPerLoad; coldWork scale 4k/1k | 9e4ef94c9188 | 8000; 24002000; 0; 24002000; 6000.50; 16.00× | 0; 0; 6363; 6363; 1.59; 4.20× | fails (calls/work/scale; decomposition diagnostic) |
| cache/eviction-scaling@4k | JS-R16-04 | hitDictionaryCalls; hitDictionaryVisits; hitLedgerVisits; hitWork | 9e4ef94c9188 | 0; 0; 0; 0 | 0; 0; 0; 0 | passes |
| cache/eviction-scaling@4k-control | control | coldWork; probeDictionaryCalls; probeDictionaryVisits; probeLedgerVisits; idleDictionaryCalls; idleLedgerVisits; loaderCalls; hitLoaderCalls; remainingEntries | 9e4ef94c9188 | 24002000; 1; 4000; 4000; 0; 0; 4000; 0; 4000 | 6363; 1; 4000; 4000; 0; 0; 4000; 0; 4000 | passes |
| computed/diamond-ladder@26 | JS-R16-06 | marks; bodyRuns | ed6263a5aa6c | 953328; 26 | 48; 26 | fails (marks); passes (bodyRuns) |
| computed/diamond-ladder@26-control | control | controlMarks; controlBodyRuns | ed6263a5aa6c | 953328; 26 | 48; 26 | passes |
| computed/live-list@1k | JS-R14-01 | subscribeCalls; extendCalls | 90f16f9f54fe | 1001; 0 | 1; 1000 | fails (subscribeCalls); extendCalls 0 on baseline = API-missing (no extend API), not a mechanism verdict |
| computed/live-list@1k-control | control | mountSubscribeCalls; mountBodyRuns; mountRenders; bodyRuns; renders | 90f16f9f54fe | 1; 1; 1; 1; 1 | 1; 1; 1; 1; 1 | passes |
| computed/live-list@4k | JS-R14-01 | subscribeCalls; extendCalls | 90f16f9f54fe | 4001; 0 | 1; 4000 | fails (subscribeCalls); extendCalls 0 on baseline = API-missing (no extend API), not a mechanism verdict |
| computed/live-list@4k-control | control | mountSubscribeCalls; mountBodyRuns; mountRenders; bodyRuns; renders | 90f16f9f54fe | 1; 1; 1; 1; 1 | 1; 1; 1; 1; 1 | passes |
| subscribe/refile-delta@1k | JS-R15-04 | exactFiles; ancestorFiles; exactUnfiles; ancestorUnfiles; unchangedExactTouches; filingWork | 868a74f30925 | 1001; 2002; 1000; 2000; 2000; 6003 | 1; 2; 0; 0; 0; 3 | fails |
| subscribe/refile-delta@4k | JS-R15-04 | exactFiles; ancestorFiles; exactUnfiles; ancestorUnfiles; unchangedExactTouches; filingWork; scales vs 1k (files/ancestors/work) | 868a74f30925 | 4001; 8002; 4000; 8000; 8000; 24003; 4.00×/4.00×/4.00× | 1; 2; 0; 0; 0; 3; 1.00×/1.00×/1.00× | fails |
| subscribe/refile-delta-control@1k | control | idleWork; removalExactUnfiles; removalAncestorUnfiles; addedWakes; keptWakes; removedWakes; removalKeptWakes; unsubscribedWakes | 868a74f30925 | 0; 1001; 2002; 1; 1; 0; 1; 0 | 0; 1; 2; 1; 1; 0; 1; 0 | passes |
| subscribe/refile-delta-control@4k | control | idleWork; removalExactUnfiles; removalAncestorUnfiles; addedWakes; keptWakes; removedWakes; removalKeptWakes; unsubscribedWakes | 868a74f30925 | 0; 4001; 8002; 1; 1; 0; 1; 0 | 0; 1; 2; 1; 1; 0; 1; 0 | passes |

All correctness tails in this group passed on both builds. Ladder values were initial 75025, first update 196418, control update 317811; every body ran once. Live-list mount/update text checks passed. Removal filing diagnostics (exact/ancestor files) were 1000/2000 and 4000/8000 before, 0/0 after. Fresh mount `mountExtendCalls` was 0 on both builds.

## #334 PG-C2 — render precision

| Entry | Finding label | Mechanism metric | Baseline build | Before | After | Verdict on baseline (fails/passes/API-missing) |
|---|---|---|---|---|---|---|
| components/mount-sibling-writer@4k | JS-R16-05 | mountRowRenders; relevantRowRenders; writes | e52def010a10 | 8000; 1; 1 | 4000; 1; 1 | fails (mount); passes (controls) |
| components/keys-parent@4k | JS-R16-01 | editParentRenders; editRowRenders; relevantParentRenders; newRowRenders | 25e3dcc45fca | 1; 1; 1; 1 | 0; 1; 1; 1 | fails (edit parent); passes (controls) |
| components/list-precision@1k | JS-R14-02+JS-R14-03+JS-R14-04 | mapParentRenders; mapRowRenders; pushParentRenders; pushRowRenders; replaceParentRenders; replaceRowRenders; spliceParentRenders; spliceRowRenders; forOfParentRenders; forOfRowRenders | c793167d0a48 | 1; 1; 1; 1001; 1; 1000; 1; 1000; 1; 0 | 0; 1; 1; 1; 0; 1; 0; 1; 0; 0 | fails (7 gates); passes (remaining gates) |
| components/list-precision@1k | JS-R14-02+JS-R14-03+JS-R14-04 | mapRelevantRenders; pushRelevantRenders; replaceRelevantRenders; spliceRelevantRenders; forOfRelevantRenders | c793167d0a48 | 1; 1; 1; 1; 1 | 1; 1; 1; 1; 1 | passes |
| write/object-replace-filter@4k | JS-R16-03 | recordedPaths; replacementBodies; replacementRenders; mountBodies; mountRenders; changedBodies; changedRenders | 1c100299e00c | 1; 1; 0; 1; 1; 1; 1 | 1; 0; 0; 1; 1; 1; 1 | fails (replacementBodies); passes (other counters) |
| write/object-replace-filter@4k | JS-R16-03 | titlePathOnly (path precision verdict, not counter) | 1c100299e00c | false | true | fails (path verdict) |
| hooks/lazy-watch@100 | R30-10 | warmInitializers; unchangedSubscriptions; coldInitializers; coldSubscriptions; unchangedSelectorCalls; unchangedCallbacks; switchedSubscriptions; switchedSelectorCalls; obsoleteSelectorCalls; changedCallbacks; changedRenders | 1a02d29eec30 | 100; 1; 200; 1; 1; 0; 1; 1; 0; 1; 100 | 0; 0; 100; 1; 1; 0; 1; 1; 0; 1; 100 | fails (warm/unchanged); passes (gated controls) |
| hooks/equals-reference@100 | R33-05 | equalRenders; equalBodies; equalComparisons; equalAnnouncements; changedRenders; changedBodies; changedComparisons; changedAnnouncements | 829c3ea9c8bf | 100; 1; 1; 0; 100; 1; 1; 1 | 0; 1; 1; 0; 100; 1; 1; 1 | fails (equal renders); passes (controls) |
| hooks/default-equal@100 | JS-R13-08 | equalRenders; equalCalls; changedRenders; changedCalls | 9386cd9a073c | 100; 100; 100; 100 | 0; 100; 100; 100 | fails (equal renders); passes (controls) |
| components/symbol-reads@1 | JS-R15-01 | concatUnrelatedRenders; toStringUnrelatedRenders; stringUnrelatedRenders; concatRelevantRenders; toStringRelevantRenders; stringRelevantRenders | d006c59494d5 | 1; 1; 1; 1; 1; 1 | 0; 0; 0; 1; 1; 1 | fails (unrelated); passes (relevant) |
| computed/equals-list@20 | JS-R15-03 | equalsEqualRenders; equalsEqualBodies; equalsChangedRenders; equalsChangedBodies; identityEqualRenders; identityEqualBodies; identityChangedRenders; identityChangedBodies | 2768ed631237 | 20; 1; 20; 1; 20; 1; 20; 1 | 0; 1; 20; 1; 20; 1; 20; 1 | fails (equals equal renders); passes (controls) |

All mount/change/done correctness checks passed in this group; filter text was `3999` on both builds. Equals-list comparison diagnostics were equal/changed 0/0 before, 1/1 after; identity-comparator calls remained 0/0. They are not additional gated counter failures.

## #335 PG-B1 — deterministic companions

| Entry | Finding label | Mechanism metric | Baseline build | Before | After | Verdict on baseline (fails/passes/API-missing) |
|---|---|---|---|---|---|---|
| history/undo-one-field@10k | R34-03 | undoRowWalks; redoRowWalks; emptyRowWalks; snapshotUndoRowWalks; wakes | d300b9a44c84 | 40000; 40000; 0; 20000; 28 | 0; 0; 0; 20000; 28 | fails (undo/redo walks); passes (controls) |
| history/undo-one-field@50k | R34-03 | undoRowWalks; redoRowWalks; emptyRowWalks; snapshotUndoRowWalks; wakes | d300b9a44c84 | 200000; 200000; 0; 100000; 28 | 0; 0; 0; 100000; 28 | fails (undo/redo walks); passes (controls) |
| history39/scale@1k | R39-02 | ownedClones; clonedNodes; controlOwnedClones; controlClonedNodes; controlDateClones | b443f8f35d2e | 1; 1002; 1; 1002; 0 | 0; 0; 2; 2010; 2 | fails (owned/cloned and Date control); passes (other clone controls) |
| history39/scale@1k | R39-02 | entryKind; controlKind (representation verdicts) | b443f8f35d2e | n/a: both metrics omitted | patches; snapshot | API-missing (metrics; no kind inference from omission) |
| history39/scale@10k | R39-02 | ownedClones; clonedNodes; controlOwnedClones; controlClonedNodes; controlDateClones; plainOwnedClones; plainClonedNodes | b443f8f35d2e | 1; 10002; 1; 10002; 0; 1; 10002 | 0; 0; 2; 20010; 2; 0; 0 | fails (write clones/plain clones/Date control); passes (other clone controls) |
| history39/scale@10k | R39-02 | entryKind; controlKind (representation verdicts) | b443f8f35d2e | n/a: both metrics omitted | patches; snapshot | API-missing (metrics; not clone proof) |
| history39/scale@10k | R39-02 | plainConstructionClones; plainConstructionNodes; plainSnapshotClones; plainSnapshotNodes | b443f8f35d2e | 1; 10002; 1; 10002 | 1; 10002; 3; 20007 | passes |
| history39/scale@10k-plain | JS-R16-07 | plainOwnedClones; plainClonedNodes; plainConstructionClones; plainConstructionNodes; plainSnapshotClones; plainSnapshotNodes | b443f8f35d2e | 1; 10002; 1; 10002; 1; 10002 | 0; 0; 1; 10002; 3; 20007 | fails (write clones); passes (controls) |
| computed/hook-publication@100 | R10-03 | pullKeys (ungated here); primitiveRenders; mapAnnouncements; mapDistinctValues; envelopeDistinctValues | f19f6f074877 | 500; 1000; 10; 1; 1 | 0; 1000; 10; 1; 1 | passes (listed gates); enumeration diagnostic only here |
| computed/hook-publication@1000 | R10-03 | pullKeys (ungated here); primitiveRenders (diagnostic here); mapAnnouncements; mapDistinctValues; envelopeDistinctValues | f19f6f074877 | 5000; 10000; 10; 1; 1 | 0; 10000; 10; 1; 1 | passes (listed gates); enumeration diagnostic only here |
| computed/hook-publication-keys@1000 | JS-R13-04 | pullKeys; pullValue | f19f6f074877 | 5000; 5 | 0; 5 | fails (enumeration); passes (value) |
| computed/hook-publication-keys-control@1000 | control | controlPullKeys; emptyPullKeys | f19f6f074877 | 6; 0 | 7; 0 | passes |
| derived/r32-fan-in@1600 | R32-02 | setWork1600/setWork100; Set constructions/adds at 100; Set constructions/adds at 1600 | 523d6a04a5f5 | 249.74×; 202/30601; 3202/7689601 | 15.15×; 103/109; 1603/1609 | fails (work ratio); decomposition diagnostic |
| derived/r32-fan-in-control@1600 | control | emptySetWork; controlSetConstructions; controlSetAdds; controlFanInWork100 | 523d6a04a5f5 | 0; 1; 3; 30803 | 0; 1; 3; 212 | passes |
| store/dehydrate@10k | R34-05 | scopeSnapshots (requires scope.toJSON for comparable work) | d300b9a44c84 | n/a: scope.toJSON absent; emitted 0 measures a different payload | 0 | API-missing; emitted zero gate passes but is not mechanism separation |
| store/dehydrate@10k-controls | control | dehydrateSnapshots; negativeSnapshots; emptySnapshots | d300b9a44c84 | 1; 1; 0 | 1; 1; 0 | passes |
| store/r32-deep-clone@10k | R32-08 | snapshotObjectCreates; probeControlCreates | 171c1fa781f3 | 20001; 1 | 0; 1 | fails (creates); passes (control) |
| store/r32-deep-clone@10k-ownkeys | R6-02 | cloneOwnKeys | 171c1fa781f3 | 10000 | 0 | fails |
| store/r32-deep-clone@10k-define | JS-R13-07 | cloneDefineProperties | 171c1fa781f3 | 0 | 0 | passes (this older build does not separate this metric) |
| store/r32-deep-clone@10k-controls | control | emptyOwnKeys; emptyDefineProperties; ownKeysControl; protoDefineControl | 171c1fa781f3 | 0; 0; 1; 1 | 0; 0; 1; 1 | passes |
| store/r32-deep-clone@10k | R32-08 | snapshotObjectCreates; probeControlCreates | 5fd73a1e30ae | 20001; 1 | 0; 1 | fails (creates); passes (control) |
| store/r32-deep-clone@10k-ownkeys | R6-02 | cloneOwnKeys | 5fd73a1e30ae | 10000 | 0 | fails |
| store/r32-deep-clone@10k-define | JS-R13-07 | cloneDefineProperties | 5fd73a1e30ae | 20000 | 0 | fails |
| store/r32-deep-clone@10k-controls | control | emptyOwnKeys; emptyDefineProperties; ownKeysControl; protoDefineControl | 5fd73a1e30ae | 0; 0; 1; 2 | 0; 0; 1; 1 | passes |
| components/ssr@4k | JS-R13-06 | instanceMethodFields | 759c94d8aa71 | 7 | 0 | fails |
| components/ssr-count@1k | control | mapWeakCalls; mapSizeReads; mapWeakCallsPerRow (diagnostics); emptyCalls; positiveCalls; positiveSizeReads | 759c94d8aa71 | 17004; 999000; 1016.00; 0; 4; 1 | 11004; 0; 11.00; 0; 4; 1 | passes (probe gates) |
| components/ssr-count@4k | JS-R13-02 | mapWeakCalls; mapSizeReads; mapWeakCallsPerRow; per-row scale 4k/1k; emptyCalls; positiveCalls; positiveSizeReads | 759c94d8aa71 | 68004; 15996000; 4016.00; 3.95×; 0; 4; 1 | 44004; 0; 11.00; 1.00×; 0; 4; 1 | fails (scale); passes (probe controls); decomposition diagnostic |

**Separate correctness/availability failures:**

- `history39/scale@{1k,10k}`: `patchKindsCorrect` false → true. Missing `entryKind`/`controlKind` is not a measured old representation; clone counters independently separate. `controlDateClones` 0 → 2 is a failed positive control, not an optimization. States, wakes and alias-contract checks pass on both builds. Plain/native wakes are 360/361; alias wakes and unrelated wakes 0; alias controls 1/1. At 1k, ungated plain construction clones/nodes are 1/1002 on both builds; plain snapshot clones/nodes 1/1002 → 3/2007. The 10k entry additionally failed three timing-scale gates (9.53× write, 10.67× undo, 10.10× redo); these are not mechanism evidence. Plain probe correctness passed for every plain probe.
- `computed/hook-publication@100`: map/envelope renders **0/0 → 1000/1000**, text `100:0` → `100:10`. At 1000: **0/0 → 10000/10000**, text `1000:0` → `1000:10`. These eight failures are **missing deliveries**, not beneficial render reductions. The separate keys entry fails on actual enumeration 5000 → 0. Primitive text/delivery and distinct-value checks pass.
- `store/dehydrate@10k`: overall baseline failure is null `scopeStringifyMs`, not the emitted zero snapshot count. `scopeToJSONAvailable` false → true, scope payload bytes 16 → 616689, and scope-payload equivalence false → true. Legacy `samePayload` and control `counterPayloadsEqual` pass on both builds; neither makes the absent API comparable.

Undo replay, cloning/copying, SSR HTML, and fan-in correctness checks passed otherwise. Fan-in work totals: 30803/7692803 → 212/3212 at 100/1600. Outer runs remain 10, value 6396009; control values 24760 and 6396010.

## #336 PG-D1 — uncovered costs

| Entry | Finding label | Mechanism metric | Baseline build | Before | After | Verdict on baseline (fails/passes/API-missing) |
|---|---|---|---|---|---|---|
| reads/live-readers@0 | control | methodCalls; idleCalls; controlCalls | 759c94d8aa71 | 30008; 0; 6 | 20001; 0; 6 | passes |
| reads/live-readers@1000 | JS-R13-02/03 | methodCalls; scale vs @0; idleCalls; controlCalls | 759c94d8aa71 | 2032008; 67.72×; 0; 6 | 20001; 1.00×; 0; 6 | fails (scale); passes (controls) |
| components/props-gate@10k | R36-07 | keyCopies; allocatedKB (heap companion); monotone (GC diagnostic) | bf6af47e7990 | 20000; 2423.98 [2423.94–2423.98]; false/true/true | 0; 1.76 [1.76–1.76]; true | fails (copies/heap/GC check); heap qualified by scavenge |
| components/props-gate@10k-control | control | controlKeyCopies; copyingKB (heap); monotone (GC diagnostic) | bf6af47e7990 | 20000; 1955.03 [1955.03–1959.83]; false/true/true | 20000; 1955.03 [1955.03–1955.03]; true | passes (copies/heap); fails (GC check; overall control FAIL) |
| history/mixed-capture@128 | R17-ENGINE-04 | rowVisits; rowCopies; intermediateCopies | a5ca525ec156 | 256; 256; 0 | 128; 128; 0 | fails (visits/copies); passes (intermediate copies) |
| history/mixed-capture@128-control | control | controlVisits; controlCopies; idleVisits; idleCopies | a5ca525ec156 | 128; 256; 0; 0 | 128; 256; 0; 0 | passes |
| reads/proxy-alloc@4k | JS-R14-07 | freshOwnTraps; freshProxies; bytesPerProxy (heap); monotone | 9c81aeec7297 | 36000; 4000; 984.53 [984.52–984.53]; true | 0; 4000; 299.03 [299.03–299.03]; true | fails (traps/heap); passes (proxy/GC controls) |
| reads/proxy-alloc@4k-control | control | idleProxies; controlProxies; controlOwnTraps; controlBytes (heap) | 9c81aeec7297 | 0; 4; 8; 64.33 [64.33–64.33] | 0; 4; 8; 64.33 [64.33–64.33] | passes |
| reads/proxy-alloc@4k | JS-R14-07 | freshOwnTraps; freshProxies; bytesPerProxy (heap); monotone | a6be80b0d25e | 0; 4000; 306.52 [306.52–306.52]; true | 0; 4000; 299.03 [299.03–299.03]; true | passes — no separation on this baseline |
| reads/proxy-alloc@4k-control | control | idleProxies; controlProxies; controlOwnTraps; controlBytes (heap) | a6be80b0d25e | 0; 4; 8; 64.33 [64.33–64.33] | 0; 4; 8; 64.33 [64.33–64.33] | passes |
| components/connect-retention@4k | JS-R15-06 | connectedOwnTraps; connectedProxies; connectedBytes; connectedBytes/plainBytes (heap companions) | a6be80b0d25e | 40000; 12001; 6672.67 [6672.67–6672.67]; 1.67× | 0; 12001; 6153.54 [6153.08–6153.81]; 1.55× | fails (traps); passes (proxy/heap ratio) |
| components/connect-retention@4k-control | control | idleProxies; controlProxies; controlOwnTraps; plainBytes (heap) | a6be80b0d25e | 0; 4; 8; 3986.04 [3985.97–3986.04] | 0; 4; 8; 3979.78 [3979.58–3988.24] | passes |
| state/resource-history | R19-ENGINE-02 | ordinarySnapshots; resourceLoads; resourceSnapshots; rootVisits; dictionaryVisits; entryVisits | fabde0984e9c | 1; 64; 129; 0; 0; 0 | 1; 64; 129; 0; 0; 0 | passes (all mechanism gates); overall FAIL is correctness only |
| state/resource-history@plain-10k | R16-PERF-01 | constructionDefines; captureDefines; captureCopies; captureIntermediateCopies | fabde0984e9c | 30000; 60000; 20000; 10000 | 0; 0; 10000; 0 | fails |
| state/resource-history@plain-10k-control | control | constructionCopies; constructionOriginalCopies; constructionIntermediateCopies; captureOriginalCopies; controlCopies; controlDefines; nativeCopies; idleCopies; idleVisits | fabde0984e9c | 10000; 10000; 0; 10000; 20000; 10000; 8; 0; 0 | 10000; 10000; 0; 10000; 20000; 10000; 8; 0; 0 | passes |

**Qualifications:** `props-gate` baseline `monotone` is false in the first sample, so its no-scavenge guarantee fails for both entries sharing those samples. Do not treat its heap magnitude as a clean allocation proof; deterministic key copies still separate. No proxy-allocation monotonicity failure occurred. Retention ratios pass on both builds; closure/trap fields, not the ratio, distinguish connect. `reads/proxy-alloc` against **a6be80b0d25e passes completely**, unlike 9c81aeec7297. The legacy `state/resource-history` fails only `redoOk` false → true; its zero visit counters do not establish R19-ENGINE-02 separation on this R16-PERF-01 baseline. Its other correctness checks pass. Plain-state snapshot kind remains `snapshot`; plain/native detachment, isolation, undo and redo checks pass. All other correctness tails in this group pass.

## #338 PG-HARNESS — property verdict and serialization

| Entry | Finding label | Mechanism metric | Baseline build | Before | After | Verdict on baseline (fails/passes/API-missing) |
|---|---|---|---|---|---|---|
| components/fast-properties@2 | JS-R14-05 | secondFast (V8 property verdict, **not a counter**) | ec98a4bb7fd1 | false | true | fails (property verdict) |
| components/fast-properties@2-controls | control | plainFast; dictionaryFast (property verdicts) | ec98a4bb7fd1 | true; false | true; false | passes |
| resource/serialization@100 | JS-R13-09 | stringifyCalls; newAbsentViews | 587587820608 | 200; 100 | 100; 0 | fails |
| resource/serialization@100-controls | control | idleStringifies; controlStringifies; identityControl; renders; loaderCalls | 587587820608 | 0; 1; 1; 101; 1 | 0; 1; 1; 101; 1 | passes |

Fast-properties uses `--allow-natives-syntax`; first-instance diagnostic `firstFast` is true on both builds. Done checks pass; resource text is `loaded` on both builds. No path-building instrumentation claim is made for repeat-child.

## #341 PG-RESID — supplemental production notes pair

This pair is **not in the 32-pair script**. The gate labels `JS-R13-05`; the audit groups that subclaim with JS-R13-02 under fix `a5cf42c`. Read-only git inspection confirmed `a5cf42ca06e0` is the WeakMap proxy-branch fix, its message says live views are filled only in development, and its parent is **759c94d8aa71731f2dbb7bb4268ddd937cbb7e74**. The reachable module moved from `Carburetor/Store/Tracking/liveViews.mjs` in the baseline to `Carburetor/Store/Tracking/Proxy/liveViews.mjs` in current; both export a callable `liveViews.note`, and the scenario tries both paths. This establishes the supplemental baseline provenance without relying on old measured values.

| Entry | Finding label | Mechanism metric | Baseline build | Before | After | Verdict on baseline (fails/passes/API-missing) |
|---|---|---|---|---|---|---|
| components/live-view-notes@4k | JS-R13-05 | renderNotes; rowsRendered | 759c94d8aa71 | 12000; 4000 | 0; 4000 | fails (notes); passes (rendered rows) |
| components/live-view-notes@4k-control | control | seamNotes; noteIsFunction (availability verdict) | 759c94d8aa71 | 1; true | 1; true | passes |

Production builds bake the development flag off: the positive control is a direct seam invocation, **not** a development-mode render. Final-row/done correctness passes on both builds.

## #331 PG-DOC — alias attribution

| Entry | Finding label | Mechanism metric | Baseline build | Before | After | Verdict on baseline (fails/passes/API-missing) |
|---|---|---|---|---|---|---|
| aliases/selection-visits@128 | R19-ENGINE-01 | firstRootVisits; firstRowVisits | ce08c7f2041a | 384; 16512 | 130; 256 | fails (upper bounds); passes (row positive bound) |
| aliases/selection-visits-repeat@128 | R30-01 | secondRootVisits; secondRowVisits | ce08c7f2041a | 384; 16512 | 128; 0 | fails |
| aliases/write-read@4k | 470a912 | rootVisits; rowVisits | e41828a41747 | 192; 256064 | 66; 4001 | fails (upper bounds); passes (row positive bound) |

Checksum, identity, recorded-path, write-landed and intact checks pass. The README identifies ce08c7f2041a as the R19-ENGINE-02 fix itself but the parent of the R19-ENGINE-01 fix; these fresh measurements establish selection-visit failure, not pre-R19-ENGINE-02 coverage. The scalar pair measures the parent of 470a912 separately.

## #337 PG-HEAP-CTRL — heap companions and hidden counters

Measured after merge with `node perf/run.mjs --only <id> --runs 3` on the current build (all green) and on the baseline (mechanism gates fail, controls pass).

| Entry | Finding label | Mechanism metric | Baseline build | Before | After | Verdict on baseline |
|---|---|---|---|---|---|---|
| cache/forget-all@4000-persist | R8-03 | persistForgetWrites; publicationDelta; subscriberCalls | 8b27dc42ac2f | 4000; 4000; 4000 | 1; 1; 1 | fails |
| cache/abort-all@4000 | R9-04 | versionDeltaAbort; storageWritesAbort; publicationDelta; subscriberCalls | a67911e6c23b | 4000; 4000; 4000; 4000 | 1; 1; 1; 1 | fails |
| views/set-data-identity@4000 | R10-06 | newViews; singleNewViews; singleSameViews | e45f466ce88e | 4000; 4000; 0 | 0; 1; 3999 | fails |
| state/restore-array-length@sparse | R7-03 | snapshotIndexVisits; truncateIndexVisits; sparseHoleWakes | c15fb04c0472 | 1000000; 999999; 1 | ≤ 10; ≤ 10; 0 | fails (validation part not guarded: the ledger is absent from production builds) |
| state/resource-history (unlocked capture) | R19-ENGINE-02 | rootVisits; dictionaryVisits; entryVisits | 728d5c8c5f3b | 2; 2; 8 | 0; 0; 0 | fails |
| array/memo-window@200k-*-live | R32-04 | liveMemoEntries; liveChildPathEntries; liveBranchMarkerEntries (view) | 523d6a04a5f5 | plain 200000; view 599998; 399999; 199999 | ≤ 2048 (fixture-specific; measured 100 plain, 149 + 50 view) | fails |
| subscribe/three-path-buckets@4k | JS-R15-05 | exactBucketObjects; ancestorBucketObjects; bucketsPerSubscriber; cacheRecordsPerSubscriber | 868a74f30925 | 12000; 12000; 6; 3 | 0; 0; 0; 0 | fails |
| subscribe/reads-copy@4k-copy-control | R6-04 (control) | internal/public/intentional Set copies | — | — | 0 / 4000 / 4000 | control only: no historical separation exists |

Not implemented: Gap #21b (`Object.keys` constructs 10000 wrappers on both builds, so no counter separates them) and the validation part of Gap #23.

## Correctness/control inventory

The following named gates pass on both builds unless the exceptions above explicitly say otherwise; they are not additional optimization claims:

- Ladder: `everyBodyOnce`, `controlEveryBodyOnce`, `resultChanged` true; `initialValue` 75025, `value` 196418, `controlValue` 317811. Live lists: `mountTextCorrect`, `textCorrect` true.
- Lazy watch: `mountOnce`, `warmOnce`, `changedOnce` true; equals-reference/default-equal: `mountOnce`, `changedOnce` true. Equals-list: `equalsMountOnce`, `equalsChangedOnce`, `identityMountOnce`, `identityChangedOnce` true.
- Undo: `snapshotCorrect`, `probeUndone`, `probeRedone`, `done` true; `undone` false. History39: `plainAliasControlWakes`, `nativeAliasControlWakes` 1; `unrelatedWakes` 0; `aliasContractCorrect`, `wakesCorrect`, `statesCorrect`, `plainProbeCorrect` true.
- Publication: `primitiveText` is `100:10`/`1000:10` on both builds. The failing delivery fields are specifically `mapRenders`, `mapText`, `envelopeRenders`, `envelopeText`, as described above. Fan-in: `outerRuns` 10; `fanInValue100` 24760; `fanInValue1600` 6396010.
- Clone: `copied`, `cloneCopied`, `protoCopied` true. SSR: `hasLastRow`, `countedHtmlCorrect` true; `htmlChars` 15899 at 1k, 66899 at 4k.
- Mixed capture and plain resource-history: `detached`, `isolated`, `undoOk`, `redoOk` true; plain resource-history also `nativeDetached` true and `snapshotKind` `snapshot`. Legacy resource-history: `ordinaryOk`, `resourceOk`, `cacheOk`, `undoOk` true; only `redoOk` fails.
- Aliases: `checksumOk`, `identical`, `pathsOk`, `writeLanded`, `intact` true. The remaining `done`/text/availability controls appear in their group notes or tables.

## Not guarded by mechanism

- **Gap #14 — store/dehydrate:** baseline lacks `scope.toJSON`; its null timing and incomparable zero snapshot count are not mechanism failure. The explicit negative control does prove the counter sees a dehydrate-based path (1 snapshot), but no historical API-equivalent before/after separation is established.
- **Gap #27b — reads/repeat-child:** `joinPath`/`branchPath` cannot be instrumented identically through immutable/inlined ESM exports with the available unmodified builds. No source patch or measurement was attempted; timing/model evidence is not a mechanism guard.

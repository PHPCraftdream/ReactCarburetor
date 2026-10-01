# Round 28 integration

## Independent verdict and completed correction

Freeze `64a5d23`: independent xs1 API **0/0/0/0**, engine **0/0/1/0** for P0/P1/P2/P3. Report-only commits transferred immediately as `d595deb` and `50c04cb`. One P2 R28-ENG-01: public single/bulk invalidation assigned through admitted readonly lifecycle fields; bulk could partly publish before the second entry threw. Not a zero combined round.

Both completed hs1 worktree slices were surgically integrated and committed immediately after parent proof:

- `f068a1f`: shared `State/Mutation/prepareCacheInvalidation` checks effective invalidated/failed changes, cloning one operational graph only for restrictive endpoints. Scalar keys avoid allocating a singleton array; ordinary writable and already-targeted locked values do not clone. Selected readonly dictionary references and affected fields gain operational capabilities on the detached graph; held endpoint flags/values remain unchanged. `applyCacheInvalidation` writes only effective changed values. Both public operations prepare before controller invalidation epoch bookkeeping or live writes; bulk preflights all entries before publication. Existing late-answer staleness/retry semantics remain active. Raw failure rebinding and pre-publication ownership rollback are centralized in `replaceOwnedCacheData`, also reused by locked removal. One shared helper owner, separate single/bulk method owners, parent integration owner; no duplicated policy or full-file conflicting cutover.
- `f068a1f`: five single and three bulk actual consumer regressions, including owned history/native backlinks, no loader, locked noops/direct subclass draft refusal, native accessor noninvocation, unrelated raw failure identity, late success/error, failed explicit retry, preparation failure before mutation/epoch changes and reentrant bulk noops. README/CHANGELOG updated.
- `5327d11`: built mixed-format consumers exercise single/bulk readonly invalidation, one version increment, held restrictions, native root/entry backlinks and usable undo/redo.

No readonly draft bypass, exception suppression, automatic loader or partial readonly preparation. Strict history/native accessor policy remains unchanged. Completed fix worktrees/junctions and browser scaffolds removed after proof; ignored dist not staged.

## Observed parent verification

- Typecheck/layout passed with existing seven-entry/600-line/one-export limits.
- Final lint passed, no errors and 50 warnings; local scratch exclusion not committed. Replaced redundant test type intersection with an explicit backlink shape and shortened overlong test title.
- Focused single/bulk/existing invalidation suite: **14/14**, three files, no skips/todos/snapshot changes.
- Initial bulk test incorrectly required a native Map payload with remapped root/entry backlinks to remain unpublished. Those native values actually change under owned replacement and are a coarse leaf. Removed that incidental suppression/order expectation rather than changing production semantics; precise untouched scalar data stays silent, affected invalidation readers each receive one complete-state publication, and nested no-op invalidation produces no extra publication. Callback lifetimes end before independent undo/redo verification. Direct-draft refusal exercises a real public subclass action rather than calling the protected method externally. Preflight error assertion does not pin private error wording.
- Built development/production CJS↔ESM boundary helper: **156** actual cases passed.
- Full suite: **1498/1498**, 140 files, no skips/todos/snapshot changes; reported duration **210204 ms**.
- Packed consumers: **16/16**, no skips/failures; React18/19 npm/pnpm CJS/ESM, strict mixed-format probe, Next16.3.5 webpack/Turbopack.
- Actual Chromium: initial a/b invalidated=false → single b=true/a=false → undo both=false → bulk both=true → undo/redo both=true. Every action increased version once; loaders stayed zero. Held b.invalidated=false and readonly descriptor remained unchanged. Native root/entry backlinks stayed correct, no browser errors. Owned tab/server/bundle removed.

## Bounded paired workload observations

Seven samples, copied round-28 engine baseline versus integrated production build; genuine workloads, not artificial machine load:

| Scenario | Baseline median ms | Integrated median ms | Preserved work |
|---|---:|---:|---|
| Ordinary patch history | 0.508 | 0.308 | 128 writes, one capture |
| Resource snapshot history | 13.627 | 14.679 | 64 loads, 128 transitions, 129 captures |
| Populated cache replacement | 0.042 | 0.036 | extra endpoint visits zero both sides |
| Mixed graph capture | 0.122 | 0.121 | root/row visits one both sides |
| Native alias selection | 0.4066 | 0.2789 | 128 lookups/checksum8128/129 paths; root2/row256 visits |
| Writable single invalidation | 0.5405 | 0.6188 | 128 entries, 128 publications, zero loaders, all stale |
| Writable bulk invalidation | 0.3468 | 0.2743 | 128 entries, one publication, zero loaders, all stale |

Last two scenarios used a bounded inline Node consumer, two warmups then seven alternating baseline/fixed samples; setup and result assertions outside timing. Single ranges baseline 0.3492–1.1247 ms, integrated 0.3473–1.5098 ms; bulk 0.2994–0.6875 versus 0.2668–0.4248 ms. Ranges overlap; no speedup or allocation-byte claim. Restrictive invalidation's necessary ownership copy is not silently shifted onto the ordinary writable path.

## Continuing independent review

Round-29 broad xs1 API/engine reviews run on identical `5327d11` source freezes and latest matrix-built ignored distributions. Closed invalidation manifestations and green gates do not establish zero combined P0–P3.

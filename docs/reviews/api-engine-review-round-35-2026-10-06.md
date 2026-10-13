# Round 35 — review of the performance gate suite, and one engine bug it found

Scope: the migration of ~40 legacy benchmarks into `perf/` (`npm run bench`), reviewed by two independent
reviewers (the rush `reviewer` role, read-only; the `ox` agent, which also ran every entry on the builds
before each improvement). Method: zero trust — every claim re-run, every gate asked "does it fail on the build
before the improvement it guards, by its mechanism and not by a timing ceiling?".

## Findings

| ID | Finding | Resolution |
|---|---|---|
| R35-01 | Engine. A `computed` returning store data (`read(store).items`) kept a view of the old data object after `setData` / `fromJSON`: both swap the data object and record only the changed leaves, which a result that read none of them never matched. `items.get().b.title` read `'B'` while the store held `'B2'`. Old bug (present before R30). | `leafVersionsDrifted` also drifts a non-primitive result when a native source's data object is not the one captured (`ILeafVersion.data`, `readStoreData`). Primitive results are unaffected (0 re-runs on an unrelated `setData`). `ReplacedData.test.ts` (7 tests, 4 fail without the fix), gate `liveresult/replace-data@10k`. |
| P-1 | Vacuous gates: passed on the build before the improvement (`subscribers/filing`, `readenum/fresh@2500`, `readable/conditional-selection`, `mount-edit`, controls labelled as improvements). | Mechanism counters added, or the entry relabelled `control` (a correctness control, not a guard). `readable` was a scenario artefact: it iterated the live listener map, so the hook re-subscribed into the same pass (128 notifications); a snapshot gives 64. |
| P-2 | Blind counters: no positive control, so an instrumentation that stops seeing the mechanism stays green (`history/r33-patches` counted `Object.create`, which the old clone also made once; `write/normalize` relied on a symbol absent on old builds; descriptor counters saw one of two primitives; `positional` and `scalar-cancellation` only had `max`). | Every counter has a control metric (`min` / `equals` on a build where the mechanism exists); probes count both `Reflect` and `Object` primitives. |
| P-3 | A broken implementation passed: `drift-*` scenarios made no related write; `selection/model` checked only positive verdicts; `normalize` checked only the last step; `positional` never checked notifications. | Related writes with new values, negative verdicts, per-step results, per-operation comparison with a plain JS array and addressed notifications. |
| P-4 | Measurement: `allocKb` was retained heap after GC, not allocation. | Measured in a child with a large semi-space and no GC in the window (3.7 MB/op before R32-05, 9 KB after). |
| P-5 | Lost on migration: `pathsIntersect` multi-write / re-registration / index heap, `forgetAll` size and persist matrix, `stateModel` (4 of 11 cases), sparse 100k arrays, date-alias persist metrics, `resourceHistory` load workload, fan-in notification counts. | Ported with gates; the legacy files deleted afterwards. |
| P-6 | Thirty-three entries for improvements older than R30 could not be checked: no build before them. | Eleven further baselines built (`perf/README.md` lists them); each such entry now fails on its build, or is a labelled control. |
| P-7 | Harness: one crashed scenario aborted the whole run; `--only` gave a false FAIL for a scale gate whose source entry was not selected; entries sharing (scenario, args) ran repeatedly; `countWriteLogMatches` returned 0 silently when the API was renamed. | `FAIL <id>` per entry and continue, scale sources pulled in, samples shared, loud failure. `--lint-gates` checks the manifest statically. |
| P-8 | Ceilings below 10x the current median, or that did not separate the build before the fix (`cloneMs`, `fanoutMs`, `snapshotMs`, `editMs`, ...). | Removed or replaced by a counter / same-run ratio. |

Rejected after checking: the reported "computed that reads only the root gets no notifications" — a computed
that reads no path has no dependency, and a leaf read after it returns extends the subscription (README
"Derived values"); `computed(read => read(s))` + `c.get().n` wakes on the next write.

## Result

Eighty-nine entries, `npm run bench` 0 violations on three consecutive runs on an otherwise idle machine; on each
build before an improvement the entries of that improvement fail by their mechanism. `--lint-gates`, layout and
oxlint are clean. Full unit suite passes.

## Open

- `perf/gates` and `perf/scenarios` are exempt from the seven-entries-per-directory rule (`FLAT_REGISTRIES` in
  `scripts/checkLayout.mjs`): one flat entry per area, 19 and growing.
- R19-01 (native alias ownership index) has no gate that fails on its own parent build; its counters stay as
  protection.
- Heap-based gates (`readenum`, `memo-window`, `transferBytes`) depend on the Node/V8 version.
- `store/restore-one-leaf` and `hooks/r33-snapshot` keep timing ratios/ceilings with a 2x–10x margin next to a
  deterministic counter gate; the counter is the guard, the timing is a sanity bound.
- CI: counter gates are deterministic and candidates for a required job; timings stay a separate optional job.
  Not wired yet.

## PG-DOC validation note — 2026-10-08

The original R19 limit above is superseded by measured checks (three samples per invocation).
Git proves `ce08c7f2041a` contains R19-ENGINE-02 and is the direct parent of
R19-ENGINE-01 fix `b33be10`; it is not a pre-R19-ENGINE-02 build. On that build,
`aliases/selection-visits@128` fails on 384 root / 16512 row visits (current 130 / 256).
`e41828a41747`, verified parent of scalar-index fix `470a912`, fails `aliases/write-read@4k`
on 192 root / 256064 row visits (current 66 / 4001). Correctness tails and row-positive
controls pass. Six sequential current invocations with `--only aliases --runs 3` pass
all five matched entries, including incidental `state/date-aliases`. The root cap is now 160.
Read-cache and repeat-selection R30 entries fail on both older builds and on the proper
pre-R30 build `1a02d29eec30`. See the PG-DOC stage receipt in `perf/README.md`.

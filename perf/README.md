# Performance gates

Every performance improvement this library ships is measured again on every run: a change that
quietly reintroduces a cost a review round removed fails the suite.

`npm run bench` measures each scenario behind `perf/gates/*.mjs` on the built distribution and
checks the recorded gates. The exit code is non-zero on any violation, so a change is guarded by
one command.

## Running

```bash
npm run build && npm run bench            # whole suite on the current build (dist/esm-prod)
npm run bench -- --only history           # entries whose id or area contains the substring
npm run bench -- --runs 5                 # samples per build (default 3)
npm run bench -- --dist <dir>             # another build, e.g. one under worktrees/bench-dist
npm run bench -- --against <git-ref>      # also build <ref> and compare every *Ms metric with it
npm run bench -- --verbose                # passing gates too, and full crash output
npm run bench -- --lint-gates             # static manifest checks, no scenario is run
npm run bench -- --list                   # print the entries without running anything
npm run bench -- --json report.json       # machine-readable results
```

A failing entry — a crash, a non-zero child, no `@@` metrics line, including a baseline build that
lacks an API the scenario needs — is reported as `FAIL <id>` with a short cause, counted as a
violation, and the run continues; the summary and exit code reflect every violation. Entries
sharing the same (scenario, args) are measured once and share their samples. `--only` still
measures the `scale.from` source entries a selected entry needs, without printing them as selected.

Ad-hoc A/B of one scenario across builds, no gates: `node perf/harness/ab.mjs <scenario.mjs>
--roots base=<dir>,fix=<dir> [--runs n] [-- args]`. To profile a scenario, run it under
`node --cpu-prof` with `DIST_ROOT` set and summarize the profile with
`node perf/harness/profile-top.cjs <file.cpuprofile>`.

## Format

A scenario is `perf/scenarios/<area>/<name>.mjs`: it reads the build under test from `DIST_ROOT`
(set by the runner, never hardcoded), takes its arguments from `process.argv`, ends with exactly
one `emit({...})` of its metrics, and always ends with a correctness check emitted as a metric, so
a broken implementation cannot look fast. Timing metrics are named `*Ms` (the `--against`
comparison picks those up); counters, strings and booleans are compared exactly. Shared helpers are
in `perf/harness/lib.mjs` (`load`, `loadPath`, `emit`, `median`, `countWriteLogMatches`,
`setupReact`, `distRoot`).

A gate entry is one element of the array in `perf/gates/<area>.mjs`:

```js
{
    id: 'history/undo-one-field@50k', improvement: 'R34-03',
    scenario: 'history/undo-one-field', args: [50000, 9],
    gates: [
        {metric: 'undoMs', max: 5},
        {metric: 'undoMs', scale: {from: 'history/undo-one-field@10k'}, max: 6},
        {metric: 'wakes', equals: 28}, {metric: 'done', equals: true},
    ],
}
```

`improvement` names the review-round item the entry guards (`R34-03`); `'control'` marks a
correctness control that is not claiming to guard a speedup.

## Which gate when

| Gate | Asserts | Use when |
|------|---------|----------|
| `equals` | every sample equals the value | counters, verdicts, rendered text |
| `max` / `min` | median within an absolute bound | deterministic counters; generous time ceilings |
| `over` | median(metric) / median(other metric of the same run) ≤ max | the cost of one path against another inside one run — machine independent |
| `scale` | median(metric) / median(same metric of another entry) ≤ max | cost at 4N rows against N rows — machine independent |

Rules, so a gate actually guards something:

- **Validate both ways.** A gate that also passes on the pre-improvement build guards nothing: run
  it there (`--dist` pointing at a baseline build) and watch it fail by mechanism — the counter,
  the ratio — not only by a timing ceiling.
- **Positive control for counters.** A counter that can silently stay 0 (a renamed internal
  method) needs a companion gate proving the instrumentation still sees the mechanism.
- **Ceilings are the last resort.** An absolute `max` on a timing only when it is at least 10x
  above the current median and still below the pre-improvement value; otherwise guard the mechanism
  with a counter or a ratio.
- Gates on counters, ratios and scale are deterministic and quiet-machine friendly; absolute
  timings are not.

`npm run bench -- --lint-gates` checks the manifest without running anything: unique ids, the
improvement label format, an existing scenario file behind every entry, at least one gate per
entry, `scale.from` pointing at a real id, gate shape, and — where the `emit({...})` call is a
plain object literal — that gate metrics are metrics the scenario actually emits.

## Adding an entry for a new round

1. Write the scenario: `perf/scenarios/<area>/<name>.mjs`, `emit` its metrics, end with a
   correctness tail. Keep at most 7 files per directory and 600 lines per file
   (`npm run check:layout`).
2. Add the entry (one per size) to `perf/gates/<area>.mjs` with `improvement: 'R<round>-<nn>'`.
3. `npm run build && npm run bench -- --only <area> --runs 3` — everything passes.
4. Build the pre-improvement baseline (`node perf/harness/baseline.mjs <parent-commit>`) and run
   the same `--only` against it with `--dist`: the mechanism gates must fail there.
5. `node scripts/checkLayout.mjs`; `node node_modules/oxlint/bin/oxlint --type-aware perf`;
   `npm run bench -- --lint-gates`.

### Round 37

All six R37 entries are permanent parts of the unfiltered `npm run bench` suite; the runner
discovers every `perf/gates/*.mjs` file automatically. No separate registration or `--only` is needed.

| Entry | Guards |
|---|---|
| `selection37/alias-topology@2` | Native/plain alias identity and values after both edits |
| `history/r37-02-delivery@4-fields` | Complete patch delivery after an observer throws, including undo/redo |
| `selection37/bounded-reads@64` | Bounded read ownership across 16/64 schema cycles |
| `selection37/patch-budget@4k` | Sparse 64/65/128 leaf writes without the old whole-list cliff |
| `selection37/primitive-wake@1` | Zero graph collections on a warmed equivalent scalar wake |
| `components/branch-migration@1` | Equal-valued class branch migration without a render |

These are mechanism/correctness gates, not latency speedup claims. Sparse reads have bounded
counters; dense walks, growing shapes and object reconciliation provide positive controls.

The six R37 gates reject `ba80fcb70719` on their actual mechanism counters/verdicts: stale aliases,
truncated patch delivery, growing read sets, the 65/128-write cliff, scalar ledgers and an extra
class render. Each baseline check uses three samples, including the scenarios' positive controls.

The `store/restore-one-leaf` entries guard R34-04 with `restoreRowWraps === 1`, the read-proxy
positive control and the delivered update. The pre-R34 build wraps every row instead (1000 at 1k).
`restoreMs` and `snapshotMs` remain diagnostic/A-B metrics: restore also diffs and publishes, so
snapshot cloning is not an equivalent-work timing control. Their old ratio ceilings failed even
on the pre-R37 build and are not used as regression gates.

The alias read-cache timing probe warms both paths with the same batches, alternates their order,
checks every iteration's checksum and reports time per traversal. Batching avoids single-traversal
timer/JIT noise without changing the `viewIterateMs / rawIterateMs <= 1.5` gate; pre-R30 still fails.

Integration verification: the unfiltered suite passed all 103 entries with three samples per build
and no violations. Run `npm run build && npm run bench` to include R37 with every existing round.

## Baseline builds

`node perf/harness/baseline.mjs <ref>` builds any commit's distribution into
`worktrees/bench-dist/<sha>` and caches it; nothing is installed — a temporary worktree under the
repository reuses its `node_modules`. One build at a time. Ready-made parents of the review-round
fixes:

| Build (sha) | Guards improvements of |
|---|---|
| `1a02d29eec30` | before R30 |
| `d77a11b03d4d` | before R31 |
| `523d6a04a5f5` | before R32 |
| `829c3ea9c8bf` | before R33 |
| `d300b9a44c84` | before R34 |
| `ce08c7f2041a` | before R19-01 / R19-ENGINE-01 |
| `b5d41aefbae1` | before R15 |
| `171c1fa781f3` | before R6-02/03 |
| `1c100299e00c` | before the precise setData/restore wake (`b443f8f`) |
| `ac9bc8907bb0` | parent of `5875878` |
| `a5cf42ca06e0` | before the per-instance proxy SSR (`ac9bc89`) |
| `c15fb04c0472` | parent of `c234c5c` |
| `20bbbacafeaf` | before R10-03 |
| `6fc13561e952` | before R10-01 |
| `8b27dc42ac2f` | before R8 |
| `687c7aa405e6` | before R9-02 |
| `ba80fcb70719` | before R37 |

## Outside the suite

`benchmarks/state/unpublishedDraftCheck.mjs` stays outside `perf/` on purpose: it measures the
unpublished-draft diagnostic, which only exists in development builds — it requires
`NODE_ENV != production` and `dist/esm`, while this suite always runs production builds
(`dist/esm-prod`, `NODE_ENV=production`).

## CI plan (not wired yet)

The counter, `equals`, ratio and `scale` gates are deterministic across machines — candidates for a
required CI job (`npm run build && npm run bench`). Timing ceilings are deliberately generous but
not noise-proof on a shared runner, so the `--against` comparison and any remaining absolute
ceilings belong in a separate, optional job. Nothing under `.github/` runs the suite yet.

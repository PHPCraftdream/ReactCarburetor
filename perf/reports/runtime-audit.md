# Runtime audit: focused performance workload and sampling

## Scope and status

This audit documents the runtime-sampling change and the available artifact scan; it is not a new
benchmark run. Local benchmark execution was intentionally not performed, so new focused, CI, and
combined-suite durations are **unmeasured**. The existing `npm run bench` step log lists
46 + 57 + 14 + 111 seconds, while its displayed total says 3:06; these do not reconcile, so this
audit does not present their sum as a verified elapsed total. The old fast-CI figure is about
11 minutes. Do not claim the new sampling meets a duration target without measuring it.

`array/positional@10k` now uses 0 warmup and 1 measured run rather than 2 and 5. The same
10,000-row fixture still exercises all six positional operations (`splice`, `shift`, `unshift`,
`reverse`, `sort`, and the middle splice), both subscribed and unsubscribed paths, and the existing
correctness, exact field-path, and wake/other-wake controls. The gates do not change. In particular,
pre-fix field-diff counters still fail the exact positional-work assertions. This is
source-workload/sampling metadata only; it does not revise a mechanism threshold or infer a runtime
gain.

## Sampling policy

`perf/sampling.mjs` is the central policy implementation (constant names may evolve). Fully
deterministic, non-timing, non-memory `equals`/`max`/`min` gates classify as `counter` and default
to one requested run. Mixed gates, ratios (`over`/`scale`), elapsed metrics, and byte/KB/MB metrics
request at least three runs; explicit larger `runs` requests are retained. A shared measurement
receives the maximum demand of its consumers, including demand propagated through `scale.from`.
Completed-operation A/B controls always retain at least three samples because that phase measures
timing, even when their blocking gates are counter-only. `--runs` requests apply to multi-sample
entries; counters stay at one unless `--counter-runs` requests otherwise. One requested pair is
informational and low confidence, not a stable performance conclusion; do not lower a gate or remove
a baseline/fix flag on that evidence alone.

Sampling-mode documentation must distinguish automatic runs from `--runs`: automatic selection
applies the policy above, while an explicit requested run count is honored subject to the
mixed/timing/memory minimum. The central phase-budget helper currently defines focused 60 seconds,
CI 300 seconds, and combined performance 2,400 seconds. These are budget constants, not measured
durations or guarantees. GitHub's top-20 elapsed summary is a partial diagnostic, not a
complete-operation ranking.

## Observed launch counts

Static launch-count observation: 777 entries map to 733 distinct measurement keys; 625 keys have
one sample and 108 keys have timing/mixed demand. For a requested three samples, the old estimate was
2,199 launches versus 949 under the updated sampling. With the new default of five performance
samples, the estimate is 1,165 versus 6,597 under the old nine-sample policy. These are static
counts, not duration measurements; each estimates one build and excludes nested process launches,
skips, builds, and calibration.

Sampling N was not reduced for positional exact gates, whose required work remains exact; the
memo-window memory signal depends on N; the live memo positive-event minimum of 200,000 is preserved;
the writelog overflow case of 4,100 remains above its cap; and store real-timing caps preserve N.


An independent raw-artifact scan found 722 metric-shape candidates: 716 stable across all 18
observations (nine before and nine after), and six unstable entries: `memo-window` plain/view
`driftKb`, retention control `plainBytes`, `draftdate46` `datePerEntryKB`, `history39`
`snapshotPerEntryKB`, and `subscribe` `heapBytesPerSubscriber`. Generic byte/KB/MB name detection
remains important protection for memory-sensitive metrics.

The following top-20 values are an **incomplete workload proxy**: sum of numeric `*Ms` metrics over
the 18 samples, excluding timeout/throttle/delay/interval constants. They are not elapsed process
or wall-clock durations. Shared scenario measurements appear under multiple entries and are
duplicated, so values are not additive. Operation timings have different units and batching;
startup work for e.g. `hooks43` is untimed. Neither process nor wall-time rankings can be derived
from this table.

| Entry/workload | Proxy seconds |
|---|---:|
| `selection43/timing-keyed@4096` | 5.501 |
| `selection42/outside-dictionary@16384` | 5.361 |
| `components/mount-edit@4k` | 3.941 |
| `cache/eviction-scaling@4k` and control | 2.997 each |
| `cache/abort-all@4000` and control | 2.313 each |
| `components/mount-edit@1k` | 1.572 |
| `selection/keys-hatch@10k` | 1.309 |
| `array/positional@10k-subs` | 1.304 |
| `selection42/outside-dictionary@4096` | 1.163 |
| `store/r33-persist@10k` | 1.113 |
| `lint-binary/scaling@8k` | 0.991 |
| `hooks44/multi-consumer@8-native` | 0.890 |
| `cache/eviction-scaling@1k` and control | 0.873 each |
| `array/positional@10k` | 0.873 |
| `hooks44/multi-consumer@8-external` | 0.784 |
| `state/resource-history@plain-10k` and control | 0.757 each |

## Verification boundaries

No builds, installations, git writes, or benchmarks were run for this task. The new sampling mode
may affect runner duration; this audit makes no claim of a faster suite, preserved total duration,
or target attainment. The artifact scan describes historical raw observations and is not a
substitute for a fresh, controlled run.

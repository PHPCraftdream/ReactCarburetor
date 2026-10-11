# API и движок: ревью, раунд 42 — 2026-10-10

Исходное review ниже сохранено как исторический срез. Реализация и лично исполненная
проверка последующего `/wcrush` находятся в [Resolution](#resolution--2026-10-11).

## Результат

**8 подтверждённых находок: 2 P1 и 6 P2.** Четыре конкретных исполнителя `xxs` исследовали независимые темы в отдельных worktrees. Orchestrator прочитал отчёты и production anchors, проверил actual report-only commits и лично исполнил все финальные tiny probes последовательно.

Reviewed base: **`fa1ad08f8cd6b26f175235a435976fcb9d94dd22`**. Эта база опубликована; [CI 38075943238](https://github.com/PHPCraftdream/ReactCarburetor/actions/runs/38075943238) завершился **success, 11/11 jobs**, включая Library, React 18, consumer matrix, native linter и шесть platform packages. Зелёный CI описывает существующую coverage, а не отсутствие найденных ниже дефектов.

Это **review-only**, не реализация восьми исправлений. После опубликованного CI-fix production, tests, benchmarks, config, зависимости и версии в этом раунде не менялись. Report commits объединяются одним squash-коммитом в `master`; новый report-only commit не является новым опубликованным CI run.

| ID | Приоритет | Подтверждённый результат / стоимость | Отчёт и направление |
|---|---|---|---|
| R42-A01 | P1 | После suspended transition class `connectSelection` оставляет видимый DOM `a:1` при store `a:2→a:3` и ошибочно переносит reads на speculative `b`. Raw class/hook controls обновляются | [React API](api-engine-review-round-42-react-api-2026-10-10.md#r42-a01--notification-gate-использует-speculative-class-selection): привязать notification gate к commit ownership |
| R42-C01 | P1 | `(A+B)+(C+D)` над одним store теряет первые constituent paths: unobserved pull возвращает **10 вместо 20**; observed eager pull в transaction также stale, хотя final delivery верна | [Computed](api-engine-review-round-42-computed-2026-10-10.md#r42-c01--потеря-constituent-paths-при-merged--merged): lossless merge всех constituent pairs |
| R42-C03 | P2, API correctness | Nullish-equivalent `equals` пропущен для baseline `undefined`: переход к `null` даёт лишнюю delivery/version; обратное направление сравнивается правильно | [Computed](api-engine-review-round-42-computed-2026-10-10.md#r42-c03--legitimate-undefined-baseline-пропускает-equals): отделить наличие baseline от его значения |
| R42-R01 | P2, lifecycle | Синхронный pre-loader `forget`/`restore` оставляет hook с отсутствующим entry, `loading` и **0 loader calls** до unrelated parent rescue | [Resources](api-engine-review-round-42-resource-2026-10-10.md#r42-r01--потеря-loading-demand-при-pre-loader-removal): восстановить потерянный committed loading signal |
| R42-R02 | P2, async ownership | Hook/class automatic load при pre-loader abort/forget/restore оставляет global `AbortError` от отброшенного `.then()` promise: **6/6 lanes**; explicit catch и обычный loader Error controls — без events | [Resources](api-engine-review-round-42-resource-2026-10-10.md#r42-r02--expected-supersession-превращается-в-global-unhandled-rejection): владеть обеими terminal ветками, не скрывать неожиданные ошибки |
| R42-C02 | P2, O / copy work | Shared-leaf fan-in при K=8/16/32 копирует **35/135/527 pair references** на actual update; [INFERENCE] накопленный prefix-copy член Θ(K²) | [Computed](api-engine-review-round-42-computed-2026-10-10.md#r42-c02--квадратичный-accumulated-parts-copy): capture-owned линейный builder, без мутации upstream metadata |
| R42-S01 | P2, O / temporary array | Outside-only dictionary wake вычисляет неиспользованный shallow patch budget: 8 wakes при width=512 перечисляют **4096 ключей**, не доставляя новый selection | [Selection](api-engine-review-round-42-selection-2026-10-10.md#r42-s01--размер-всего-словаря-вычисляется-для-плана-без-patch-children): не считать size без inside-root work; сохранить planner и raw-target proof |
| R42-S02 | P2, O | Shared ancestor bucket при 64 sibling writes и 64 broad readers даёт **4096 candidate adds ради 64 deliveries**; unmatched precise subscriber остаётся silent | [Selection](api-engine-review-round-42-selection-2026-10-10.md#r42-s02--одинаковый-ancestor-bucket-обходится-заново-для-каждого-sibling-write): match-local dedup обхода одного bucket, не только id |

P2 performance означает доказанный устранимый scaling-член конкретного workload. Это **не** измеренная задержка кадра, экономия total allocated bytes или обещание общего ускорения. Ни один proposed fix/A-B prototype не исполнялся.

## Проверка orchestrator

Один supplied current distribution: `worktrees/bench-dist/fa1ad08f8cd6/{cjs,cjs-prod,esm,esm-prod}`. Node **v24.12.0**, React/ReactDOM **19.3.0**, JSDOM **30.0.1**. База собрана и smoke-проверена до delegation; agents не пересобирали shared targets. В parent выполнены **14 отдельных Node processes**, по одному за раз:

| Тема | Cwd внутри `worktrees/` | Лично исполненные команды | Наблюдённая coverage |
|---|---|---|---|
| Computed | `review-r42-computed-20261010` | `node worktrees/r42-computed-probe.mjs cjs`, затем `cjs-prod`, `esm`, `esm-prod` | Все три findings во всех четырёх formats; reverse/flat/merged+bare, distinct-store, cold/reverse-equals и observer/external controls |
| React | `review-r42-react-api-20261010` | `node worktrees/r42-react-api-concurrent.cjs cjs cjs`, затем `esm cjs`, `cjs-prod esm-prod`; `node worktrees/r42-react-api-controls.cjs` | 24 реальные ReactDOM lanes: self/child suspension, StrictMode, raw/hook controls; normal equal-branch migration, source swap, wave/drain/cancel controls |
| Resources | `review-r42-resource-20261010` | `node worktrees/r42-resource-probes/cancellation.mjs`, `removal-boundary.mjs`, `warm-cost.mjs`, `reader-removal.mjs` | Actual public hook/class events; before/after/replacement phases; catch original vs dropped child promise; narrow-selector warm controls; non-React token/notification corroboration |
| Selection | `review-r42-selection-20261010` | `node worktrees/r42-selection-probes/costs.mjs`, `controls.mjs` | Independent dictionary and P/N scales; held snapshots/identity, native/plain aliases, sparse holes/own-undefined, escaped paths/refile/remove, opt-in/dispose controls |

Все commands завершились exit 0. Это successful reproduction **текущих дефектов и controls**, не pass нового regression suite или доказательство исправления. Mixed development formats в React probe выдали существующие duplicate-copy diagnostics; они не подавлялись. React concurrency lanes используют development React для `act`, включая production library bundles; resource probes используют production React. Runtime UI evidence — JSDOM, не Chromium.

Исходники подтвердили runtime mechanisms: `captureLeafVersions.ts:27–35`, `announceIsUnchanged.ts:37–47`, class `Reads.tsx:180–240,251–335` и pending/committed attempts; `createResourceReader.ts:166–188,299–322`, `ResourceCacheLifecycle.ts:140–153`; patch planner budget и ancestor bucket collection. Parent LSP нашёл actual `captureLeafVersions` caller в `Computed.ts:439`; agents отдельно указали недоступность LSP в своих sessions.

Новые full tests/perf sweep/packed matrix, React 18 review probes, browser, heap/GC/CPU profiling и byte measurements **не выполнялись**. Их нельзя подменять зелёным baseline CI. Полные snippets, representative stdout, source anchors, positive controls и точные limits сохранены в тематических отчётах; оригинальные ignored probe files удаляются вместе с task worktrees после интеграции.

## Порядок реализации и benchmark acceptance

1. **A01 и C01 — первыми.** Раздельные correctness boundaries: committed selection ownership и complete leaf freshness. Не лечить stale output remount-ом, wildcard subscriptions или отключением precision shortcuts.
2. **C03 и R01/R02.** Comparator baseline должен корректно включать `undefined`; automatic resource reader должен владеть terminal outcome и актуальным demand. R01/R02 можно реализовать вместе, но сохраняются два независимых acceptance. Не добавлять общие retries и `.catch(() => undefined)`.
3. **C02, S01, S02 — после correctness.** C01/C02 делят capture helper: сначала полный output, затем линейное построение. Каждая оптимизация требует whole-operation baseline/fix comparison и защиты дешёвых controls; не выводить bytes/latency из constructor/iterator counters.

Proposed **новые**, ещё не созданные benchmark families:

- A01: `components/selection-commit-ownership` — visible DOM/reads при real suspended transitions, actual commit/resume/cancel и release; не pin-ить speculative render counts между React majors.
- C01/C02/C03: `computed42/merged-pair-freshness`, `computed42/fan-in-part-work`, `computed42/undefined-equals` — every eager checksum, lossless constituent coverage, bounded pair-copy work, comparator arguments/version/deliveries и cold controls.
- R01/R02: `resource42/pre-loader-removal`, `resource42/auto-load-supersession` — paused replacement without parent rescue, obsolete loader calls, owned expected rejection, ordinary/custom failure visibility и generation teardown.
- S01/S02: `selection42/outside-dictionary`, `subscribe42/common-ancestor` — no unused dictionary enumeration, one shared-bucket visit, exact precision/values, single-write/disjoint controls.

Существующие gate contracts **не менять**: `computed/diamond-ladder@26`, `computed/diamond-ladder@26-control`, `derived/r32-fan-in@1600`, `derived/r32-fan-in-control@1600`, `derived/drift-fan-in@10k`, `computed41/dependencies-*`, `computed41/observer-lifetime`, `computed/equals-list@20`; `components/branch-migration@1`, hook/class precise renders; `resource40/*`, `resource41/*`; `writelog39/interleaved-{watch,hook,class}@{1000,10000}`, `selection37/*`, `selection38/*`, `readset40/*`, `subscribe/match-precision@{100,1k,4k}` и refile/bucket controls. Тематические отчёты перечисляют дополнительные existing tests и adversarial cases. После будущей реализации нужны сохранённые новые scenarios в общем runner и единый старый+новый benchmark прогон; в этом review их не создавали и не запускали.

## Scope и provenance squash

Оригинальные report-only commits всех четырёх `xxs` имеют parent reviewed base и содержат ровно один назначенный файл:

| Исполнитель | Original report commit | Файл |
|---|---|---|
| `xxs` / R42Resource | `1b978369bc53679be736d5264b43131f6279abbe` | [resource report](api-engine-review-round-42-resource-2026-10-10.md) |
| `xxs` / R42Computed | `218d5aa4f21ea71452cc41b0a3430b5363865b94` | [computed report](api-engine-review-round-42-computed-2026-10-10.md) |
| `xxs` / R42Selection | `20a1bc7f4f8dd6ed4a1bbe57cc192f7db87a24bf` | [selection report](api-engine-review-round-42-selection-2026-10-10.md) |
| `xxs` / R42ReactApi | `2d3b18431bfd3454cfc90ec6146aa5a78c0af3d7` | [React/API report](api-engine-review-round-42-react-api-2026-10-10.md) |

Orchestrator добавляет этот обзор и уточняет exact fan-in control gate names. Итоговая интеграция — один report-only squash commit с пятью Markdown files. Original hashes — provenance, не отдельные commits основной линейной истории. Unrelated `.claude/scheduled_tasks.lock` не входит в commit. Report squash локальный: новый push этим review не запрашивался.

## Resolution — 2026-10-11

Все восемь findings реализованы относительно report base
`023056be1951ba2632901a3fa2ee29db19e3a984`; performance baseline —
`fa1ad08f8cd6b26f175235a435976fcb9d94dd22` с тем же исходным production code.
Три Rush sessions работали в отдельных in-repo worktrees: Computed, React/Resources
и Selection. Phase 1 не исполняла tests или scenarios; phase 2 разрешалась явно
в тех же sessions и выполнялась последовательно. Orchestrator лично проверил
объединённый код в четвёртом integration worktree.

### Исправленная семантика и стоимость

- **A01:** notification-time `connectSelection` сравнивает только snapshot, принадлежащий
  committed attempt с актуальными props/state; speculative selection не переносит reads.
  Успешный новый commit всё ещё выполняет equal migration без owner/child render.
- **C01/C02:** capture-owned builder сохраняет все constituent pairs без изменения borrowed
  records и старых snapshots. Повторный diamond pair дедуплицируется по reads-Set identity
  **и captured version**; разные versions не теряются. Shared-leaf fan-in больше не копирует
  накопленный prefix parts при каждом добавлении.
- **C03:** наличие equality baseline отделено от его значения. Legitimate `undefined`
  участвует в `equals(undefined, next)`; cold read не вызывает comparator. Accepted baseline
  сохраняет identity/version/delivery contract, а live/same-reference carve-outs не меняются.
- **R01/R02:** автоматический reader владеет обеими terminal branches исходного load promise.
  Expected cache supersession определяется exact source/promise provenance через WeakRefs,
  а не именем `AbortError`; unexpected/custom rejection остаётся видимым. Retired generation
  не переустанавливает demand и не крадёт уже созданную replacement request.
- **S01:** outside-only write-log plan не вычисляет неиспользованный dictionary shallow size.
  Planner, root/ancestor fallback, accumulated raw-target proof и native/raw-exposure guards
  сохраняются.
- **S02:** Set identity dedup создаётся только при первом multi-ID ancestor bucket. Один
  prefix backfill учитывает уже посещённые exact slots, включая parent-first overlap;
  subsequent exact/ancestor slots сохраняют first-add order. Distinct exact-only matches,
  single writes и singleton buckets не создают дополнительную dedup collection.

### Регрессии, обнаруженные до интеграции

Первый объединённый suite прошёл 2665/2666 tests и обнаружил extra class render при двух
absent resource entries. Immediate refile после первого load удалял multi-key absent-default
suppression до второго load. Class drain теперь сначала запускает все committed loads
и владеет их terminals, затем принимает loading dependencies. Между этими фазами возможны
abort/forget/restore: post-start publication evidence и owner/path/load guards восстанавливают
потерянный demand fresh render/commit, а не recursive loading.

Существующий `FieldReaders.test.tsx` с cold owner render **1** не изменён. Новые public
between-start controls требуют replacement **до любого settlement**, исключают retired answer,
проверяют второй request и teardown. Recovery без actual Pending/refreshing publication не
запускается: иначе field-capable custom rejection превращался в update-depth loop.
Custom-only loads не создают terminal Map или adoption array.

Первый seven-process A/B обнаружил distinct multi-ID control slowdown за действующим
25% + 0.05 ms policy. Eager exact-slot metadata удалена, а не скрыта новым порогом.
Permanent controls теперь проверяют zero exact-only dedup work, constructor ceilings
и реальное parent-first/child-first bucket traversal.

Первый unfiltered benchmark sweep прошёл 295/296 entries; единственный старый failure —
`writelog39/write-bytes@6000`, `savedBytes=68.6027` при неизменном upper bound **60**.
Frozen baseline и disposable current distribution с original matcher прошли тот же контракт.
Optimizer trace показывает compilation внутри heap-measurement windows; total-byte экономия
по этому относительному metric не утверждается.

Single-write matching отделён от multi-write backfill в небольшой hot path, без metadata
collection и без изменения wake semantics. После этого исходный scenario/gates прошёл **5 samples**:
`savedBytes=-9.07 [-9.31–-4.62]`, ceiling по-прежнему **60**; consumer/monotone/positive heap controls
и offBytes bounds сохранены. Новый subscriber family прошёл 20 entries × 3 samples, focused
Selection — 62/62 tests. Ни scenario, ни старый threshold не переписаны для получения green.

### Permanent coverage

**43 новых entries** автоматически обнаруживаются существующим `perf/run.mjs`:

| Family | Entries | Защита |
|---|---:|---|
| `computed42` | 14 | Merged freshness, undefined equals, K=100/400/1600 shared/distinct part work и separate uninstrumented whole update+get |
| `components42` | 1 | Actual suspended commit/cancel/resume, visible DOM, reads, warm reuse и release |
| `resource42` | 2 | Pre-loader removal, cold multi-entry class, between-start cancellation, original/child promise ownership и unexpected visibility |
| `selection42` | 6 | Width=16/128/512/4096/16384 outside dictionary wakes и conservative topology controls |
| `subscribe42` | 20 | Independent P/N scales, actual bucket visits/additions, metadata positive control, precise delivery/order и cheap distinct controls |

Instrumentation charges actual arrays/buckets/constructors only in separate work windows,
restores patched methods in `finally`, and includes empty and positive controls. Metadata
probe uses saved native membership for filtering, so it does not charge its own filter lookup.
References, key enumeration, visits and constructor calls **не являются allocated-byte замерами**.
Timing lanes используют отдельные uninstrumented fixtures и реальные завершённые operations.

### Baseline/fix: работа и whole-operation timing

Frozen production baseline: `fa1ad08f8cd6b26f175235a435976fcb9d94dd22`.
Node v24.12.0, Windows x64, i7-11800H; семь alternating independent process samples
на каждый build, `capt 4 belownormal`. Both builds проходят одинаковые public checksums,
delivery counts и snapshot/history invariants.

| Workload / единица | Baseline median, ms [min–max] | Fix median, ms [min–max] | Baseline/fix |
|---|---:|---:|---:|
| Shared Computed K=1600; complete update+get | 10.216 [8.800–11.282] | 2.736 [1.999–3.230] | 3.73× |
| Outside dictionary width=4096; 16 complete cycles | 132.094 [108.343–147.188] | 77.405 [68.775–84.160] | 1.71× |
| Outside dictionary width=16384; 16 complete cycles | 733.305 [671.628–887.751] | 403.814 [363.131–456.539] | 1.82× |
| Shared subscriber P=256/N=256; 32 complete publications | 55.670 [48.655–64.560] | 16.100 [13.376–18.785] | 3.46× |
| Distinct subscriber P=64/N=4 control; 32 publications | 6.850 [5.802–8.065] | 7.033 [6.090–8.247] | 0.97× |
| Distinct Computed K=1600 control; complete update+get | 3.088 [2.641–4.848] | 3.142 [2.569–6.572] | 0.98× |

Все **22 new whole-operation comparisons** проходят неизменную 25% + 0.05 ms A/B policy.
Последние два controls — не speedup claims. Width=512 cold diagnostic первоначально дал flag;
actual baseline/fix calibration с 512 warm cycles показала startup sensitivity. Только NEW
dictionary scenario получил одинаковый warmup на обоих builds; six selection42 entries × 3
samples затем прошли. Финальный width=512 batch median: **0.9597→0.8631 ms**.

| Детерминированная работа | Baseline | Fix |
|---|---:|---:|
| Shared constituent references, K=100 | 5 049 | 100 |
| Shared constituent references, K=400 | 80 199 | 400 |
| Shared constituent references, K=1600 | 1 280 799 | 1 600 |
| Outside dictionary keys, width=16384, eight wakes | 131 072 | 0 |
| Shared bucket member visits/additions, P=256/N=256 | 65 536 | 256 |
| Actual exact/ancestor overlap member visits/additions | 8 | 4 |

Убрана quadratic prefix-copy/traversal work в shared capture и repeated P×N bucket work.
Selected edits по-прежнему материализуют dictionary snapshots; whole dictionary operation
не объявляется O(1). Constructor/reference counters не подменяют allocated bytes.

Supplemental old-scenario A/B: все **253 original contracts** прошли на baseline и fix,
без crashes, но семь affinity-controlled samples дали **17 timing flags по 12 unique
scenario/args workloads**. Это отдельный наблюдаемый результат, не «zero latency regressions».
Флаги встречаются и на unchanged paths; identical-build A/A и focused calibrated A/B прошли.
Paired threshold-excess sign-permutation diagnostic: min p=0.1875, без individual p<0.05.
Этот diagnostic не отменяет raw flags и не меняет действующую A/B policy.

### Hardware InstructionRetired — спорные старые workloads

Windows WPR strict `InstructionRetired` + `TotalCycles` on CSwitch, не sampling/IR count:
[PMU event contract](https://learn.microsoft.com/en-us/windows-hardware/test/wpt/recording-pmu-events).
Non-elevated start реально отказал с `0x80070005`; elevated collector запущен после explicit
operator consent. Каждая отдельная instance остановлена в `finally`; чужие tracing sessions
и registry не менялись.

Первый большой trace выполнил 72/72 workloads, но потерял **569 876 events** и отбраковался.
Recorder затем получил bounded **64 MiB** buffers и отдельную запись на каждый workload.
Приняты **12 traces / 72 runs / 234 marked windows / 23 349 295 PMC snapshots**:
**0 lost events/buffers, 0 unmatched switches, 0 counter decreases, 0 broken thread continuity,
0 partial main-thread boundary slices**.

Counter delta считается на том же logical CPU между consecutive CSwitch snapshots и
приписывается outgoing benchmark main TID. Source bytes/args не менялись; scoped runtime
loader добавлял only begin/end markers вокруг уже существующих operation windows.
Три alternating process samples на build, inherited four-logical-processor affinity и
BelowNormal priority. WPR marker children не входят в benchmark PID counts.

| Targeted window | Baseline retired instructions, millions [min–max] | Fix retired instructions, millions [min–max] | Fix/base delta |
|---|---:|---:|---:|
| Alias view iteration; 32 iterations, warmed median | 22.972 [22.941–23.158] | 23.097 [23.064–23.117] | +0.54% |
| Cache hit batch; 1000 loads | 11.822 [11.816–11.944] | 12.019 [11.887–12.100] | +1.66% |
| Computed map; 10 complete updates | 2708.247 [2232.083–2936.095] | 2237.069 [2212.262–2659.933] | −17.40% |
| R32 fan-in K=400; nine updates including two warmups | 68.938 [68.030–70.327] | 65.301 [63.995–75.015] | −5.28% |
| R33 branch; nine updates | 23.329 [22.895–23.788] | 23.543 [23.537–23.573] | +0.92% |
| Mixed history; one construction with original probe | 13.541 [12.838–13.705] | 13.655 [13.620–13.832] | +0.84% |
| Memo rows; nine edits | 5880.852 [5845.643–5940.602] | 5905.885 [4058.144–6040.791] | +0.43% |
| Stable hook; fifteen no-write renders | 29.240 [28.623–29.763] | 28.956 [28.782–29.812] | −0.97% |
| Sparse width=256; ten updates | 32.956 [32.130–33.080] | 32.495 [32.323–32.879] | −1.40% |
| Sparse width=65536; five updates | 81.649 [80.866–82.233] | 81.045 [80.823–82.548] | −0.74% |
| Raw pathsIntersect; 200 calls | 359.155 [281.022–403.901] | 388.267 [368.791–401.640] | +8.11% |
| Bound write/watch; original complete rounds including quiet wakes | 27.151 [26.758–27.473] | 27.455 [27.374–27.834] | +1.12% |

Raw pathsIntersect compiled module побайтово одинаков: 291 bytes,
SHA256 `7765ed67c38e63dc67ee0f659b91064b42f318b0a63830a15a651b4c30c1fafc`.
Его hardware ranges перекрываются; +8.11% не объявляется доказанным speedup или zero-cost claim.
Hardware samples не воспроизводят 25–63% роста main-thread work из timing flags. **[INFERENCE]**
Это evidence против broad CPU-work regression, а не доказательство отсутствия любого latency
изменения и не waiver существующей timing policy.

Единица — retired instructions **marked main-thread window**, включая JS/native/runtime,
kernel/interrupt work и marker-return/spawn boundary overhead. Cold import/setup/warmup
вне named windows исключены, кроме явно указанного R32 warmup; background JIT/GC worker
threads исключены. Empty-marker positive floor сохраняется отдельно и не вычитается;
цифры не выдаются за «чистое число JS операций» или allocated bytes.

Durable local inputs: `.rush/stdin/r42-hardware/split-receipt-1791698032724.json`,
`instruction-comparison.json`, per-trace ETL, source SHA256, public metrics, markers and
attributed integer counters. `r42-final-gains-warmed.json` сохраняет все 22 timing comparisons;
`r42-final-existing-ab-controlled.json` сохраняет все raw old flags.

### Hardware: три основные новые оптимизации

Ещё **3 separate traces / 18 alternating runs / 108 marked windows / 7 324 892 PMC snapshots**
прошли тот же zero-loss/continuity/boundary protocol. Все public values, checksums,
body/leaf runs, deliveries, history/sharing и precision invariants совпадают на обоих builds.
Combined acceptance: **15 traces / 90 runs / 342 windows / 30 674 187 PMC snapshots**.

| Whole-operation window | Baseline retired instructions, millions [min–max] | Fix retired instructions, millions [min–max] | Меньше instructions |
|---|---:|---:|---:|
| Shared Computed K=1600; 112 update+get after warmup | 3114.723 [3109.355–3118.682] | 1787.237 [1775.783–1797.094] | 42.62% |
| Dictionary width=4096; 16 complete cycles after 512 warm cycles | 800.610 [796.957–803.446] | 517.257 [514.763–517.327] | 35.39% |
| Shared subscriber P=256/N=256; 32 complete publications | 551.086 [548.754–554.613] | 107.095 [107.000–107.146] | 80.57% |

Для dictionary/subscriber каждый process summary — median семи existing operation windows;
Computed window содержит все 112 measured update+get. Table summary — median трёх independent
process summaries. Диапазоны before/after на этих трёх workloads не перекрываются. Это
физическое снижение measured main-thread instructions с указанным overhead, не clock-speed
speedup, не IR-size proxy и не byte-allocation claim.

Raw proof: `.rush/stdin/r42-hardware/split-receipt-1791699173685.json`, `instruction-gains.json`
и referenced per-trace ETL/counters; исходные cold/timing/invalid-trace receipts сохранены.

### Лично исполненная проверка

- Combined build: четыре ESM/CJS dev/prod distributions, declarations и lint package.
- После переноса в primary `master` заново собраны actual package exports и исполнены пять
  public scenarios: 32 freshness cases, 8 equality cases, selection ownership и оба resource
  boundaries. Expected global rejections **0**, unexpected failures остаются видимыми;
  cold class owner render **1**, registration balance **0**. Это проверка actual primary dist.
- Все четыре configured typechecks, standard lint и layout прошли; warnings от coarse/native
  и deliberate negative fixtures остаются, не скрывались.
- Manifest lint: **296 entries, 0 problems**.
- Focused combined: **204/204 tests**, 15 files, 0 failures/skips/todos.
- Полный combined `npm test`: **2688/2688 tests**, 264 files, 0 failures/skips/todos.
- Final-source unfiltered common benchmark: **296/296 entries × 3 samples**, 0 failures/violations.
  Все 253 old entries и 43 новых исполнялись одним существующим runner. **44 original manifests**
  побайтово совпадают с сохранённой базой; thresholds, arguments, IDs и scenarios не менялись.
  После финального new dictionary warmup повторён весь common runner; ещё **296/296 × 3**
  прошли без failed/violations. Receipt: `.rush/stdin/r42-precommit-common-bench.json`.
- Packed consumers: **16/16 checks**, 0 failures/skips — React 18.3.1/19.3.0, npm/pnpm,
  ESM/CJS, cross-format selection, Next 16.3.5 Turbopack и Webpack. Проверялся actual tarball,
  а не repo source или незапакованный dist; dependency/project versions не повышались.
- Actual Chromium: committed `a` обновляется при suspended `b`; cancel и resumed `b`
  доставляют актуальные значения. Unobserved merged total **10→20**. Removed pre-loader
  demand достигает `ready` с одним loader call, без global browser errors.
- Chromium class cold pair: starts `[0,1]`, default DOM `…:…`, owner render **1**;
  real settlements доставляют `user 0:user 1`, не дублируя loaders.

Supplemental Node v24 cancellation-lifetime control сохраняет caller-held Error и strong
cache control. На baseline и fix cache/promise collectible во всех четырёх formats после
public `error.stack` materialization. Raw unformatted Error удерживает cache на обоих
ESM builds; это explicit observed limit, не claim новой GC экономии.

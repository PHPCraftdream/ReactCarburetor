# API и движок: ревью, раунд 42 — 2026-10-10

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

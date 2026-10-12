# API и движок: ревью, раунд 43 — 2026-10-11

## Результат

**10 новых подтверждённых findings: 1 P1, 8 P2, 1 P3.** Четыре выбранных пользователем исполнителя **xxs** исследовали независимые темы, записали отдельные отчёты и сделали собственные report-only commits в изолированных worktrees. Parent проверил source anchors, фактические commits и лично исполнил bounded probes последовательно.

Reviewed base: **`90a1c6041c2d33d3e9d307a79856deb67a9a67db`**, завершённая реализация R42. Следующий номер выбран по существующим отчётам: последний раунд — 42. Исправленные R42 findings и старые noisy timing flags не переобъявляются новыми дефектами.

Исходный отчёт в commit `07e0ae2` — **review-only**: production, tests, benchmarks, configs, dependencies и версии тогда не менялись. Четыре report commits объединены одним squash с этим обзором и parent verification дополнениями. Push и новый CI в review не запрашивались; последующая реализация и фактические проверки описываются в resolution ниже.

| ID | Приоритет | Лично наблюдённый результат | Отчёт / направление |
|---|---|---|---|
| **R43-S01** | **P1, correctness** | Signed-zero writes достигают raw store, но scalar/graph watch пропускает delivery; отменённое NaN изменение даёт extra delivery. 18 discrepancies из 35 cases на каждом format. В Chromium graph hook/class selection остаются `Infinity` при source `-Infinity` | [Selection](api-engine-review-round-43-selection-2026-10-11.md#r43-s01--samevalue-verdict-не-проходит-через-change-gates): SameValue на content gates, не глобальная замена key/topology equality |
| **R43-C01** | **P2, error recovery** | `equals` бросает на первом refresh; повторный `get()` возвращает непринятый candidate без повторного verdict. Recovery теряет исходную accepted baseline identity, revision остаётся 0 | [Computed](api-engine-review-round-43-computed-2026-10-11.md#r43-c01--comparator-failure-коммитит-unobserved-cache-раньше-acceptance): согласованная acceptance/rollback boundary |
| **R43-C02** | **P2, O / traversal** | K=8/M=8 aliases дают 64 common membership probes ради 9 итоговых pairs; merged-first control — 8, distinct-extra — 0 | [Computed](api-engine-review-round-43-computed-2026-10-11.md#r43-c02--повторный-borrowed-group-scan-после-первого-merge): capture-local borrowed-record identity dedup после collision |
| **R43-S02** | **P2, O / history** | Scalar coalesced batch P=8/32/64 даёт 28/496/2016 accesses к earlier patch verdict. Separate publications — 0; undo/redo и owned descendant folding проходят | [Selection](api-engine-review-round-43-selection-2026-10-11.md#r43-s02--scalar-batch-quadratic-folding-search-без-возможного-target): пропуск невозможного owned fold search |
| **R43-C03** | **P2, lifetime** | Живой observed scalar computed после equal source migration держит retired source только в announcement checkpoint. Changed/unobserved controls collectible; last release освобождает equal target | [Computed](api-engine-review-round-43-computed-2026-10-11.md#r43-c03--active-equal-migration-удерживает-obsolete-announcement-sources): продвигать settled dependency checkpoint без delivery/version/value-identity изменений |
| **R43-A01** | **P2, lifecycle retention** | Mounted raw class после source swaps удерживает 4 obsolete props payloads при живых retired stores; connect/hook controls — 0. Текущий DOM/precision/teardown корректны | [React API](api-engine-review-round-43-react-api-2026-10-11.md#r43-a01--transient-render-ownership-остаётся-в-persistent-tracked-view-cache): отделить persistent view от transient recorder route |
| **R43-S03** | **P2, retention** | Caller-held Date без backlink удерживает replaced root и unrelated rows через alias answer. No-read control collectible; overwrite answer тем же native освобождает old root/payload | [Selection](api-engine-review-round-43-selection-2026-10-11.md#r43-s03--native-alias-answer-удерживает-посторонний-obsolete-root): root-first weak ownership без потери generation/alias precision |
| **R43-R01** | **P2, capacity/lifetime** | При maxEntries=1 после post-start abortAll и нового paused load остаются 3 entries, из них 2 unretained. Reader-release/current-settlement controls оставляют 1; refresh data и ordinary errors сохранены | [Resources](api-engine-review-round-43-resource-2026-10-11.md#r43-r01--отменённый-request-не-сообщает-ledger-что-появился-свободный-кандидат): сбрасывать skip hint после реального освобождения request |
| **R43-R02** | **P2, arguments retention** | Last object query graph остаётся жив после miss/forget/forgetAll/restore/setData-empty и primitive traffic; другой object query освобождает все 5 targets, loader calls — 0 | [Resources](api-engine-review-round-43-resource-2026-10-11.md#r43-r02--object-key-memo-держит-arguments-graph-вне-entry-lifetime): убрать strong private memo owner, не вводить consumer cleanup API |
| **R43-A02** | **P3, React18 SSR diagnostic** | Development React18 выдаёт 2 store-hook layout warnings; empty/class/computed/resource — 0, intentional layout positive — 1. HTML корректен, hydration recovery — 0; React19 dispatcher silent | [React API](api-engine-review-round-43-react-api-2026-10-11.md#r43-a02--старый-store-hook-не-применяет-существующий-server-commit-effect-contract): существующий server/client commit-effect choice |

P2 scaling означает наблюдённую устранимую работу и **[INFERENCE]** соответствующий asymptotic член, не измеренные latency/bytes/instructions gains. Lifetime evidence показывает достижимость/collectibility небольших targets при живых owners, не размер heap saving. A02 — diagnostic на поддержанном renderer, **не** доказанный hydration mismatch.

## Лично исполненная проверка

Один immutable current distribution: `worktrees/bench-dist/90a1c6041c2d/{esm,esm-prod,cjs,cjs-prod}`, скопированный из already-built primary R42 bundles, без rebuild. Parent сначала проверил watch/Computed values, delivery и disposal во всех четырёх formats. Initial throwaway loader использовал неправильный CJS suffix; corrected к existing `resource42/importPart` (`index.js`). Это fixture error, не library finding; raw attempt сохранён.

Environment: Node **v24.12.0**, React/ReactDOM **19.3.0**; SSR compatibility cell — **React18.3.1**. GC probes используют маленькие fixtures, job boundaries и explicit GC **без artificial memory/CPU pressure**. Parent runtime commands выполнялись последовательно под `capt 4 belownormal`; agents исполняли только чтение и scoped report commits.

| Parent run | Исполнение / controls | Наблюдение |
|---|---|---|
| `r43-core-probes.mjs` | 5 mechanisms × 4 formats = **20 processes** | C01 acceptance failure/recovery и body-error controls; C02 independent K/M/order/distinct axes, immutable upstream metadata и deliveries; C03 equal/changed/unobserved/held + release/rejoin; R01 abort/abortAll/refresh/TTL/release/error/retry controls; R02 five no-loader routes, empty/strong/captured/object-turnover controls |
| `r43-ui-selection-probes.mjs` | Selection 3 × 4 formats, raw-class lifetime 2 formats, React18 SSR/hydration 4 formats + child-layout gap, React19 control 2 formats = **21 processes** | S01 raw/history/flat/finite/no-op/sparse controls; S02 exact fold accesses, restored descriptors, publication/precision, full undo/redo; S03 valid GC/overwrite/getter controls; A01 real mounted DOM, warm reuse, retirement and teardown; A02 forwarded stderr, real SSR markup, hydration, observed/unread writes/source swap/release |
| Actual Chromium | `r43-browser/entry.mjs`, in-memory owned server, real button clicks | `+0→-0`: source/scalar hook/raw class `-Infinity`, graph hook/selection class `Infinity`; watch scalar/flat/graph deliveries 0/1/0. Finite edit reaches `0.5` everywhere. **0 browser errors**, screenshot; root disposed, tab/server closed |

Все **41 targeted processes** дали валидное reproduction evidence. C01/C02/C03 recipes завершаются expected final desired-invariant assertion failure **после** successful controls и diagnostics: это доказательство текущего gap, не падающий новый permanent test и не pass исправления. Остальные 29 processes — exit 0 с inspected structured results. Diagnostics development mixed server/client copies не подавлялись.

Особые границы:

- S01 подтверждён и API callbacks, и actual visible React DOM. SameValueZero для Map/Set keys/members не нарушается proposed direction; signed-zero values — иной контракт.
- C02 measured common probes: K=1/4/8 и M=4/8. **[INFERENCE] Θ(K·M)** после collision; это не исправленный R42 accumulated-prefix copy.
- S02 one-update и transaction совпадают с P(P−1)/2; empty=0, positive=1, separate=0. Object+descendant fold всё ещё необходим.
- C03 удерживает initial announcement source set, не все когда-либо выбранные sources. Caller/value-held graphs — legitimate positive ownership; retention не объявляется unbounded per switch.
- A01 runtime evidence — production React19 + JSDOM, по четыре small payloads. Chromium GC, heap bytes, abandoned-attempt и same-source first-payload liveness matrix в этом round не измерялись; explicit strong route подтверждён source.
- R01 не требует eviction внутри abort; finding — missing retention-change signal для **следующего** штатного fetch. Late cancelled settlement не восстанавливает ledger hint.
- R02 — один last object arguments graph, не primitive LRU или removed payload resolution R41. `ResourceCarburetor.reload()` legitimate last args owner не затрагивается.
- Parent LSP нашёл 4 references `lastKeyArgs` (slot/read/write), без lifecycle clearing; 5 references `EvictionLedger.release` (declaration, refile/unsubscribe, current success/failure), без abort route. Agent sessions не имели LSP; их ограничение сохранено в topic reports.

Raw local receipts: `.rush/stdin/r43-baseline-smoke.json`, `r43-core-probes.json`, `r43-ui-selection-probes.json`, `r43-browser-receipt.json`. Полные самодостаточные snippets, source anchors и proposed future gates находятся в четырёх отчётах. Scratches удаляются с task worktrees; проверенные inputs/receipts сохраняются отдельно от Git deliverable.

## Исходный порядок реализации и benchmark acceptance

1. **S01 correctness первым.** Чинить весь reachable content/change gate chain, сохраняя key/topology semantics, sparse holes, native/plain alias proof и precision. Не маскировать отсутствие delivery wildcard/remount/custom special-case comparator.
2. **C01 acceptance boundary.** Equality failure не может стать successful cached candidate; recovery сравнивает с последним accepted baseline. Не добавлять общий retry API и не подавлять comparator exception.
3. **Lifetime/capacity:** C03, A01, S03, R01, R02. Сохранять existing committed ownership, late/reentrant replacement, captured snapshots, deliberate strong callers и cheap warm controls. У C03 private `announced` identity pins — incidental implementation tests: удалить их вместо re-pin, защитить публичные values/versions/deliveries/ownership.
4. **C02 и S02 scaling** после correctness. Capture-local exact-input dedup и publication-local possible-owned-target hint предпочтительнее global caches/tries/new knobs. Обязательны no-collision/K=1, separate publication, positive owned-object folding и retained metadata controls.
5. **A02** использует существующую isomorphic effect convention, без console suppression и без безусловного passive effect на client. SSR и fresh-client module imports проверять раздельно.

На момент исходного review предложены **ещё не созданные** permanent families:

- `selection43/same-value` — complete scalar/container IEEE-value matrix и actual committed DOM.
- `computed43/equality-failure-acceptance`, `repeated-borrowed-group`, `observed-equal-source-lifetime` — acceptance identity/errors, bounded input traversal и equal-migration collection.
- `history43/scalar-batch`, `aliases43/retired-root` — independent publication axes и root/native ownership.
- `components43/tracked-route-lifetime`, `hooks43/store-ssr-commit-boundary` — current owner semantics, cheap reuse, React18/19 diagnostics/SSR/hydration.
- `resource43/cancel-frees-eviction`, `object-args-lifetime` — post-start pressure/reentry and no-loader argument ownership.

Новые gates после реализации должны войти в existing common runner рядом со всеми **296 current entries**. Old thresholds/args/IDs не ослаблять. Counter/GC lanes отделять от uninstrumented completed-operation baseline/fix timing; physical InstructionRetired/heap bytes заявлять только после отдельного actual measurement. В этом review новые benchmarks, prototypes и fixes не реализованы.

## API решение

Подтверждённых оснований для нового public retry/dispose/query knob либо удаления class/computed adapter нет. Простое направление — устранить внутреннее impossible work и лишнее ownership, сохранив существующие consumer shapes. Любой будущий exported API cutover требует references, всех callers/type consumers и clean migration без compatibility shim; его gains нельзя выводить из размера public surface.

## Resolution: реализация R43

Все **10 findings** исправлены без нового public API, compatibility shims, изменения версий или зависимостей. Production baseline — `90a1c6041c2d33d3e9d307a79856deb67a9a67db`; task base — report-only `07e0ae2ab225bdb85cebabb3e7bd032cc540b393`.

### Исправления и границы контрактов

- **C01:** value, revision и freshness checkpoint принимаются атомарно. Исключение comparator оставляет последнюю accepted baseline; recovery, source write и reentrant self-read проверены отдельно. Два обычных checkpoint objects на changed unobserved recompute остаются: экономия их аллокаций не заявляется.
- **C02:** capture-local дедупликация exact borrowed merged record. Первый record обходится без Set; Set появляется только при втором distinct merged input и заполняется через `add`, без временного seed array. Сохранены порядок, pair identity, captured versions и upstream snapshots.
- **C03:** equal observed migration обновляет announcement ownership, не меняя публичные value/version/delivery. Incidental private-object identity pins удалены, а не перепривязаны.
- **S01:** content/change gates используют SameValue для values, включая `NaN` и signed zero. Map/Set keys и members сохраняют SameValueZero; sparse holes и topology не приравниваются к dense/undefined.
- **S02:** publication-local possible-owned-target hint исключает quadratic fold search для scalar-only history. Owned-object endpoints и replay остаются положительными контролями.
- **S03:** native alias answers принадлежат weak root-local cache; ответ не хранит obsolete root. Alias/getter/backlink precision и parent/child ownership сохранены.
- **R01:** abort сначала отсоединяет original request; hint освобождается только для surviving, unretained original entry. Abort-listener replacement, root replacement и paused next-load проверены; eager eviction не добавлена.
- **R02:** private object-argument identity — development-only WeakRef; production memo хранит serialized bytes, не graph. Mutable arguments по-прежнему сериализуются и диагностируются; primitive LRU budget не изменён.
- **A01:** attempt/entry attribution очищается после close. Bound top-level route recorder не захватывает props/attempt даже после ESM-production minification; committed ownership сохраняется.
- **A02:** существующая isomorphic commit-effect convention применена к обеим store-hook boundaries. SSR не подавляет console; client acquisition остаётся layout, до passive effects.

### Проверка исполнения

| Проверка | Фактический результат |
|---|---|
| Объединённый suite после warm-key tuning | 273 files; **2799 passed**, 0 failed/skipped/todo |
| После final Set seed cleanup | **229/229 Derived tests**; повторный полный 471×3 common run и fresh packed matrix 16/16 прошли |
| Build / configured checks | ESM, ESM-production, CJS, CJS-production, declarations; typecheck, full lint, layout, manifest прошли |
| Common runner | **471 entries × 3 samples**, 0 failures/violations; 175 новых и все 296 прежних |
| Packed consumers | **16/16**, 0 skipped: React18/19 × npm/pnpm × ESM/CJS; cross-format selection; Next webpack/turbopack |
| Primary checkout после transfer | Actual four-format build; **175 new entries × 1**, 0 failures/violations; configured full lint прошёл |
| Chromium, combined ESM-production | Видимый DOM: `+0 → −0 → +0 → 2 → NaN`; comparator recovery; deferred cancellation capacity; 0 browser errors |
| Cancelled NaN в Chromium | 0 extra selection callbacks и hook commits; class path-wake controls сохранены |

Каждый finding проверен parent не только по final text агента: public tests/direct four-format children, отдельные source/copy negative mutations и byte-identical restoration. У A01 первоначальный factory minifier снова замкнул lexical scope в ESM-production: lifetime gate обнаружил retention; окончательный bound recorder прошёл все 12 format/count GC children. У Selection substantive phase 2 завершилась, но configured reviewer вернул stream `INTERNAL_ERROR`: его PASS не заявляется; personal review и independent sensitivity выполнены parent.

Legacy `resource40/hook-renders` обнаружил настоящий fixture flake: 20ms timer не гарантировал completed React commit. Теперь fixture ждёт observable phase и присоединяет реальные load promises; прежние exact render/loader/value assertions сохранены. Пять samples на baseline и пять на fix прошли до итогового common sweep. Все 49 прежних gate-module SHA256, IDs, args и thresholds сохранены; утверждение «старые scenario bytes вообще не менялись» было бы неверным.

Локальные raw receipts сохраняются в `.rush/stdin/`: `r43-parent-*-proof.json`, `r43-parent-*-sensitivity.json`, `r43-combined-tests-command.json`, `r43-integration-static-tail.json`, `r43-common-bench.json`, `r43-combined-packed-command.json`, `r43-fixed-browser-receipt.json`. GC проверяет bounded job-boundary collectibility с alive-owner/captured-snapshot/turnover controls, без allocation pressure; counts не выдаются за heap bytes.

### Измеренные mechanism gains

| Реальная нагрузка / метрика | Baseline | Fix |
|---|---:|---:|
| C02, K8/M8: borrowed membership probes | 64 | 8 |
| S02, P8 coalesced scalar publication: earlier-verdict visits | 28 | 0 |
| S02, P32 coalesced scalar publication: earlier-verdict visits | 496 | 0 |
| S02, P64 coalesced scalar publication: earlier-verdict visits | 2016 | 0 |
| S01, cancelled NaN graph: delivered callbacks | 1408 | 0 |
| R02, живые cache owners: collected argument roots/subtrees | 0/5 | 5/5 |
| A01, mounted raw class, props count 4: retained obsolete props | 4 | 0 |

History owned-object fold positive control — 1, empty publication — 0. C02 merged-first остаётся 8, no-collision — 0; это не claim об исчезновении всех leaf-version allocations. Resource collectibility не меняет canonical JSON keys, loader calls или strong caller/captured owners.

Отдельные uninstrumented completed-operation lanes использовали five alternating independent processes и точные finite/checksum/publication controls:

| Нагрузка; median ms | Baseline | Первый fix |
|---|---:|---:|
| S01 keyed width4096, 128 cancelled operations | 528.907 | 82.708 |
| S01 тот же finite positive control | 544.560 | 511.426 |
| R02, 65536 object hits | 64.881 | 71.599 |
| R02, 65536 fresh-object misses | 70.389 | 57.007 |
| R02, 65536 primitive hits | 32.387 | 28.823 |
| R02, 65536 primitive misses | 7.790 | 7.787 |

У keyed cancellation диапазоны **496.200–612.246 / 71.757–88.445ms**, separation есть. Finite/resource wall ranges перекрываются; universal latency/allocation improvement не заявляется. Первоначальная flat-container S01 timing fixture не измеряла graph path; её raw результаты сохранены, но не используются как доказательство выигрыша.

### InstructionRetired: actual measurement и пределы

С пользовательским разрешением сняты **107 lossless ETW traces**, **222 реальных workload processes**. Только собственные именованные WPR sessions, 4 logical processors, BelowNormal, последовательные heavy runs. Все принятые traces имеют zero lost events/buffers, zero counter decreases/broken continuity/unmatched switches и zero partial marker-boundary slices. Одна trace с **16 708 lost events** отвергнута целиком; её results не участвуют в выводах. Pair-per-trace collection устранила loss без увеличения memory budget.

Атрибуция — CSwitch/PMC deltas только benchmark main thread. Background JIT/GC workers исключены; main-thread JS/native/runtime/kernel и interrupts включены. Границы строго привязаны к SHA256 и exact source lines, semantic controls проверены на обоих builds. Empty marker overhead **не вычитается**; timings под hardware markers не используются как uninstrumented timings.

| Нагрузка; median retired instructions, полный window | Baseline | Измеренный fix |
|---|---:|---:|
| S01 keyed4096 cancelled, spawn-marker protocol | 2 022 886 412 | 292 799 986 |
| C02 K16/M64 bare-first, spawn-marker protocol | 20 149 722 | 16 641 248 |
| S02 P256 one publication, spawn-marker protocol | 12 891 755 | 11 479 580 |
| C01 unobserved scalar control, spawn-marker protocol | 45 684 269 | 46 873 714 |
| R02 object-hit65536, named-pipe confirmation | 429 499 055 | 436 622 362 |
| R02 fresh-object miss65536, named-pipe confirmation | 441 848 448 | 363 701 975 |
| R02 primitive-hit65536, named-pipe confirmation | 171 205 426 | 168 722 209 |
| R02 primitive-miss65536, named-pipe confirmation | 74 578 201 | 84 236 681 |

Первый протокол park-at-boundary через main-thread `spawnSync(wpr)` имеет большой floor; short controls им доминируются. Named-pipe helper переносит process spawn вне benchmark thread и прошёл отдельный lossless probe, но не делает любой короткий window точным. Например P1 history сохраняет существенную empty-window долю и перекрывающиеся process ranges; отсутствие малой CPU-регрессии ему не доказано. C01 scalar добавляет checkpoint work; его measured cost не скрывается и не выдаётся за allocation saving. Primitive-miss confirmation также имеет перекрывающиеся ranges.

После R02 confirmation parent убрал две избыточные memo writes при unchanged serialized production key. `JSON.stringify`, primitive budget, weak-identity clearing при смене environment и development diagnostics сохранены. Этот final warm-key tuning прошёл повторный build/static, full suite и common sweep; **InstructionRetired после него не переснят**. После сообщения пользователя о недоступном UAC новых elevation prompts не запускалось. Physically measured pre-tuning source и все его bundles сохранены отдельно: `.rush/stdin/r43-resource-key-pre-tuning.ts.txt`, `.rush/stdin/r43-pre-tuning-dist.zip` (1139 byte-verified files).

Финальная canonical lookup проверка: **9 samples × 3 builds**, flag args `--iterations 65536`; каждый sample подтвердил 262144 operations, checksum 2031616, zero loader calls и completed result.

| Final confirmation; median ms [sample range] | Baseline | Pre-tuning fix | Final |
|---|---|---|---|
| Object hit | 98.26 [76.68–254.35] | 102.63 [67.17–123.17] | 100.53 [85.42–434.49] |
| Fresh-object miss | 105.28 [71.89–202.88] | 76.11 [59.94–87.90] | 83.77 [53.11–99.65] |
| Primitive hit | 43.24 [35.78–57.42] | 38.67 [29.39–54.24] | 41.85 [37.15–49.54] |
| Primitive miss | 9.96 [6.38–35.04] | 10.46 [8.48–13.37] | 11.95 [9.14–15.61] |

Диапазоны перекрываются: отдельный latency win финальному micro-tuning не приписывается. Raw 27 samples и summaries сохранены в `.rush/stdin/r43-final-warm-lookup-*.json`. Первоначальный throwaway launch передал positional iterations вместо fixture flag; exact operations assertion отверг его, он не является gain evidence.

Полный original-baseline A/B проверил все 296 прежних entries: zero behavior/work gate failures на обоих builds и zero crashes, но **30 timing flags на 22 workloads**. Flags сохранены, original 25% comparator не ослаблен. Hardware windows не подтверждают крупный main-thread instruction growth для этих workloads, однако marker-dominated controls не дают права объявить все wall flags закрытыми либо universal «регрессий нет».

Nine-sample confirmation исходных flagged workloads вместе с scale dependencies проверила 29 entries: zero behavior/work violations/crashes; **7 timing flags на 4 workloads** остались. Это не новая baseline и не изменение thresholds. Полные ranges сохранены:

| Оставшийся metric; ms [sample range] | Baseline | Fix |
|---|---|---|
| `components/mount-edit@4k unmountMs` | 111.84 [81.77–889.43] | 158.84 [97.64–421.10] |
| `computed/hook-publication@1000 envelopeMs` | 4.74 [3.89–10.09] | 7.03 [3.25–8.87] |
| `subscribe/reads-copy@1k subscribeMs` | 5.54 [3.72–12.57] | 7.43 [4.42–10.22] |
| `subscribe/refile-delta@1k removalMs` | 0.3010 [0.2113–0.8239] | 0.3766 [0.2037–0.8026] |

Три envelope flags и два refile flags — shared samples разных существующих entries, не независимые повторы. Ranges перекрываются; крупный latency regression им не доказан, но comparator flags не превращены в PASS. **Envelope phase не снята InstructionRetired**: прежняя hook-publication trace относится к primitive phase; подменять ею envelope proof нельзя. Raw confirmation: `.rush/stdin/r43-flag-confirmation.json`.

Для проверки специфичности alerts выполнен отдельный **A/A/B** experiment: 9 samples каждого из двух имён **одного и того же frozen build** и final build, 8 existing entries / 5 workloads с dependencies. Behavior/work gates — zero violations на всех трёх. Comparator дал **4 A/A flags при идентичном коде**:

| Identical-build metric; ms | Frozen A | Тот же frozen B |
|---|---:|---:|
| `components/mount-edit@4k editMs` | 3.4204 | 9.2214 |
| `components/mount-edit@4k replaceMs` | 11.8265 | 19.4911 |
| `subscribe/refile-delta@1k removalMs` (два existing entries) | 0.2798 | 0.3935 |

В A/B исходные семь flagged metrics не повторились; сохранились **два других** point alerts на dependency `components/mount-edit@1k`:

| Dependency metric; ms [sample range] | Frozen A | Final |
|---|---|---|
| `replaceMs` | 2.53 [2.16–5.39] | 4.72 [2.14–10.98] |
| `unmountMs` | 15.76 [12.44–21.46] | 27.47 [13.37–68.24] |

Неспецифичность 25% wall comparator продемонстрирована, а не предположена. Все alerts и ranges сохранены; experiment не повторяется «до зелёного» и не заменяет original A/B. Установленного устойчивого code-caused latency regression этими runs нет; отсутствие любой малой latency/CPU цены **не доказано**. Raw: `.rush/stdin/r43-wall-controls.json`.

Reusable inputs, strict analyzer, raw receipts и оба protocol results: `.rush/stdin/r43-hardware/`; десять inputs — в byte-verified `inputs.zip`, агрегаты — `inclusive-instruction-summary.json`, `pipe-confirmations.json`. Archives сохраняют reproducibility без generated code в default source-lint scope. Для финальных latency выводов важны отдельные uninstrumented measurements, не число constructor calls и не вычитание marker floor.

## История исходного report-only squash

Каждый original report-only commit имеет parent reviewed base и ровно один назначенный Markdown file:

| Исполнитель | Original report commit | Файл |
|---|---|---|
| `xxs / R43Computed` | `ee213b1a7d8a9bb21be86308381732e9e6f33e63` | [Computed](api-engine-review-round-43-computed-2026-10-11.md) |
| `xxs / R43ReactApi` | `3c11d54b90db0ab9e7b1a0c7d3e4712bcf041ed4` | [React API](api-engine-review-round-43-react-api-2026-10-11.md) |
| `xxs / R43Selection` | `55fa1efd1fb02f92ba9bc2770dd02ca7c5692449` | [Selection/history](api-engine-review-round-43-selection-2026-10-11.md) |
| `xxs / R43Resource` | `ed2eabe986d25f993e6a99d8dc3055034b1ddcd2` | [Resources](api-engine-review-round-43-resource-2026-10-11.md) |

Для исходного review parent выполнил `git merge --squash` четырёх report branches и добавил overview с фактическими verification appendices. Результат — **report-only `07e0ae2ab225`, пять Markdown files** в `master`; original hashes — provenance, не четыре новых commits linear history. История не переписывалась. Последующая реализация R43 переносится отдельным scoped commit: production, tests, permanent benchmarks и existing docs. Unrelated `.claude/scheduled_tasks.lock`, shared node_modules/native target, frozen baseline и чужие worktrees сохраняются; push этим task не запрашивался.

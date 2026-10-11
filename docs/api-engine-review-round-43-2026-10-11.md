# API и движок: ревью, раунд 43 — 2026-10-11

## Результат

**10 новых подтверждённых findings: 1 P1, 8 P2, 1 P3.** Четыре выбранных пользователем исполнителя **xxs** исследовали независимые темы, записали отдельные отчёты и сделали собственные report-only commits в изолированных worktrees. Parent проверил source anchors, фактические commits и лично исполнил bounded probes последовательно.

Reviewed base: **`90a1c6041c2d33d3e9d307a79856deb67a9a67db`**, завершённая реализация R42. Следующий номер выбран по существующим отчётам: последний раунд — 42. Исправленные R42 findings и старые noisy timing flags не переобъявляются новыми дефектами.

Это **review-only**, не реализация следующих исправлений. Production, tests, benchmarks, configs, dependencies и версии не меняются. Четыре report commits объединяются одним `git merge --squash` с этим обзором и parent verification дополнениями. Push не запрашивался; новый CI, full tests/perf sweep и packed matrix в этом review не запускались.

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

## Порядок будущей реализации и benchmark acceptance

1. **S01 correctness первым.** Чинить весь reachable content/change gate chain, сохраняя key/topology semantics, sparse holes, native/plain alias proof и precision. Не маскировать отсутствие delivery wildcard/remount/custom special-case comparator.
2. **C01 acceptance boundary.** Equality failure не может стать successful cached candidate; recovery сравнивает с последним accepted baseline. Не добавлять общий retry API и не подавлять comparator exception.
3. **Lifetime/capacity:** C03, A01, S03, R01, R02. Сохранять existing committed ownership, late/reentrant replacement, captured snapshots, deliberate strong callers и cheap warm controls. У C03 private `announced` identity pins — incidental implementation tests: удалить их вместо re-pin, защитить публичные values/versions/deliveries/ownership.
4. **C02 и S02 scaling** после correctness. Capture-local exact-input dedup и publication-local possible-owned-target hint предпочтительнее global caches/tries/new knobs. Обязательны no-collision/K=1, separate publication, positive owned-object folding и retained metadata controls.
5. **A02** использует существующую isomorphic effect convention, без console suppression и без безусловного passive effect на client. SSR и fresh-client module imports проверять раздельно.

Proposed **ещё не созданные** permanent families:

- `selection43/same-value` — complete scalar/container IEEE-value matrix и actual committed DOM.
- `computed43/equality-failure-acceptance`, `repeated-borrowed-group`, `observed-equal-source-lifetime` — acceptance identity/errors, bounded input traversal и equal-migration collection.
- `history43/scalar-batch`, `aliases43/retired-root` — independent publication axes и root/native ownership.
- `components43/tracked-route-lifetime`, `hooks43/store-ssr-commit-boundary` — current owner semantics, cheap reuse, React18/19 diagnostics/SSR/hydration.
- `resource43/cancel-frees-eviction`, `object-args-lifetime` — post-start pressure/reentry and no-loader argument ownership.

Новые gates после реализации должны войти в existing common runner рядом со всеми **296 current entries**. Old thresholds/args/IDs не ослаблять. Counter/GC lanes отделять от uninstrumented completed-operation baseline/fix timing; physical InstructionRetired/heap bytes заявлять только после отдельного actual measurement. В этом review новые benchmarks, prototypes и fixes не реализованы.

## API решение

Подтверждённых оснований для нового public retry/dispose/query knob либо удаления class/computed adapter нет. Простое направление — устранить внутреннее impossible work и лишнее ownership, сохранив существующие consumer shapes. Любой будущий exported API cutover требует references, всех callers/type consumers и clean migration без compatibility shim; его gains нельзя выводить из размера public surface.

## Scope и provenance squash

Каждый original report-only commit имеет parent reviewed base и ровно один назначенный Markdown file:

| Исполнитель | Original report commit | Файл |
|---|---|---|
| `xxs / R43Computed` | `ee213b1a7d8a9bb21be86308381732e9e6f33e63` | [Computed](api-engine-review-round-43-computed-2026-10-11.md) |
| `xxs / R43ReactApi` | `3c11d54b90db0ab9e7b1a0c7d3e4712bcf041ed4` | [React API](api-engine-review-round-43-react-api-2026-10-11.md) |
| `xxs / R43Selection` | `55fa1efd1fb02f92ba9bc2770dd02ca7c5692449` | [Selection/history](api-engine-review-round-43-selection-2026-10-11.md) |
| `xxs / R43Resource` | `ed2eabe986d25f993e6a99d8dc3055034b1ddcd2` | [Resources](api-engine-review-round-43-resource-2026-10-11.md) |

Parent выполняет `git merge --squash` этих четырёх branches, добавляет данный overview и фактические verification appendices. Итог — **один report-only commit, пять Markdown files** в `master`; original hashes — provenance, не четыре новых commits основной linear history. Предыдущая история не переписывается. Unrelated `.claude/scheduled_tasks.lock` не входит в commit; shared node_modules/dist и другие worktrees не удаляются. Новый push/CI этим round не запрашивался.

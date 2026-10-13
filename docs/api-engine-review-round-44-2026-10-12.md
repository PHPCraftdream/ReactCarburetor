# API и движок: ревью, раунд 44 — 2026-10-12

## Результат

**9 новых подтверждённых findings: 1 P1, 5 P2, 3 P3.** Четыре конкретных исполнителя **xxs** независимо исследовали Computed, React/API, selection/history и resources. Parent прочитал все четыре отчёта, проверил production anchors и лично исполнил bounded reproductions последовательно. Findings R41/R42/R43 и исправленные React18 diagnostic fixtures не переобъявляются новыми.

Reviewed base: **`acfd3e2b8e58210ce1076bf1683f666283216af5`**. Последний существующий отчёт — раунд 43, поэтому выбран **N+1 = 44**. [CI этой базы](https://github.com/PHPCraftdream/ReactCarburetor/actions/runs/38215097583) завершился success, 11/11 jobs; это existing coverage, не доказательство отсутствия нижеописанных дефектов.

Это **review-only**: production, tests, benchmarks, конфигурация, зависимости и версии не менялись. Исправления, prototypes и новые permanent benchmark families не реализованы. Один report-only commit содержит этот обзор и четыре тематических отчёта. Push в данном запросе не требуется.

| ID | Приоритет | Лично наблюдённый результат | Отчёт / направление |
|---|---|---|---|
| **R44-S01** | **P1, correctness** | У допустимых массивов с prototype `null`/`Object.prototype` raw edit применяется, но graph watch теряет delivery. В Chromium graph hook и class selection попадают в error boundary с `slice is not a function`; scalar hook/raw class показывают новое значение | [Selection](api-engine-review-round-44-selection-2026-10-12.md): корректный shallow spine copier с prototype/holes/identity proofs |
| **R44-R-01** | **P2, settlement ownership** | Reentry из `String(rejection)`/`Error.message` getter повреждает restored Success. Single-slot стирает replacement request: новый loader завершён, но Success потерян | [Resources](api-engine-review-round-44-resource-2026-10-12.md): acceptance check после user-code description boundary |
| **R44-A01** | **P2, retention** | Stopped scalar `connectSelection` declarations сохраняют 4 obsolete props targets при alive mounted owner и active subscriptions 0; raw/connect controls collectible; re-arm освобождает targets | [React API](api-engine-review-round-44-react-api-2026-10-12.md): освобождать obsolete closure-owned attempt attribution, сохраняя committed guard |
| **R44-A02** | **P2, retention** | После настоящего SSR hook read живой native/external source уже отдаёт новый объект, но global computed-hook snapshot держит obsolete subtree; no-hook controls collectible | [React API](api-engine-review-round-44-react-api-2026-10-12.md): snapshot ownership по consumer lifetime, без snapshot identity/publication churn |
| **R44-C01** | **P2, scaling** | K aliases над M stores повторно перечисляют K·M bare leaf entries/UID calls, хотя output имеет M+1 leaves: K8/M8 — 64, K16/M16 — 256; direct repeated-read control — 8 | [Computed](api-engine-review-round-44-computed-2026-10-12.md): immutable exact-snapshot reuse и capture-local processed-snapshot accounting |
| **R44-S02** | **P2, work / temporary ownership** | После already-opaque history verdict продолжается owned endpoint copying, не используемое snapshot entry: 6/34/170 after-opacity reflection visits | [Selection](api-engine-review-round-44-selection-2026-10-12.md): не строить ненужные endpoints, но сохранить replay/structural markers |
| **R44-C02** | **P3, allocation/work** | Уже observed stale recompute создаёт key array прежнего M-leaf checkpoint ради `hadValue`, который этому route не нужен: 1 call/M entries при M=1/8/32 | [Computed](api-engine-review-round-44-computed-2026-10-12.md): проверять `wasUnobserved` до eligibility enumeration |
| **R44-S03** | **P3, allocation machinery** | Primitive final-path replay verdict создаёт 2 graph WeakMaps на patch: P64 — 128 constructors на каждом undo/redo; ordinary record — 0, graph positive — 2 | [Selection](api-engine-review-round-44-selection-2026-10-12.md): primitive verdict до graph context, не менять topology/SameValue policy |
| **R44-R-02** | **P3, allocation opportunity** | Imperative fresh ready cache hits возвращают H разных fulfilled Promise<void>: H=8/32 даёт 8/32 identities при loaders/publications/callbacks 0; pending join действительно shared | [Resources](api-engine-review-round-44-resource-2026-10-12.md): оценить ленивый void completion с explicit identity/async-hooks tradeoff |

P2 scaling/work означает устранимый source-backed member и наблюдённые bounded counts, **не** измеренный whole-operation speedup. Lifetime означает reachability/collectibility при alive owners и controls, не heap bytes. Р44 не подтверждает новый общий extra-render bottleneck; S01 — ошибка доставки/рендера, а не удачный bailout.

## Лично исполненная проверка

Parent заморозил существующие current bundles в `worktrees/bench-dist/acfd3e2b8e58/{esm,esm-prod,cjs,cjs-prod}`. Primary build выполнен после final R43 Set cleanup; subsequent `acfd3e2` менял только test/benchmark diagnostics, не `lib/src`. Нового rebuild для review не было. Entry hashes/provenance — `.rush/stdin/r44-base-build.json`; four-format public store/computed/resource smoke — `r44-base-smoke.json` с exact input и output.

| Тема | Accepted отдельные Node processes | Исполненная coverage |
|---|---:|---|
| База | 4 | Public update/watch/computed values и ready resource load/forget в четырёх formats |
| Computed | 8 | Две exact recipes × четыре formats; 24 fan-in graph cases и 24 observed/unobserved scalar cases |
| Selection/history | 12 | Три exact recipes × четыре formats; supported array prototypes, opaque timing boundary и scalar replay record windows |
| Resources | 8 | Две exact recipes × четыре formats; 12 error-description lanes и 8 ready/lookup/pending-join controls на format |
| React lifetime | 2 | Frozen ESM-production, React19.3 production: mounted class/DOM и настоящие native/external SSR hook reads; bounded GC/job turns |

**34 accepted Node processes**, exits 0. Все использовали настоящий current public API; instrumentation returns original results, restores intrinsics и отделяет счётчики от timing. Development diagnostics array probe сохранены как data. Exit 0 здесь означает воспроизведённый дефект/current cost вместе с passing controls, а не реализованное исправление.

Первый parent React запуск через Bun-host `spawnSync` с 30s deadline вернул null status и **не принят как proof**. Native Node serial runner сохранил outcomes до assertions и повторил exact recipes с 180s child deadline; обе завершились exit 0, stderr empty. Initial rejected attempt сохранён отдельно. В GC нет allocation pressure, synthetic stress или heap-size claim.

Raw local inputs/receipts: `.rush/stdin/r44-parent-computed-proof.json`, `r44-parent-selection-proof.json`, `r44-parent-resource-proof.json`, `r44-parent-react-proof.json`, `r44-parent-react-initial.json`. Тематические файлы содержат complete self-contained sources и exact observed stdout, поэтому они не зависят только от локальных ignored logs.

### S01: проверка настоящего browser surface

Parent отдельно открыл managed Chromium на временном приложении, импортирующем frozen ESM-production. Stable graph watch, graph/scalar hooks и graph/raw classes читают один store на каждый prototype. Нажаты реальные кнопки finite edit; обычный массив — positive control.

| Array prototype после edit | Source | Graph watch deliveries | Graph hook / class | Scalar hook / raw class |
|---|---:|---:|---|---|
| `Array.prototype` | 1 | 1 | `1` / `1` | `1` / `1` |
| `null` | 1 | 0 | Caught TypeError / caught TypeError | `1` / `1` |
| `Object.prototype` | 1 | 0 | Caught TypeError / caught TypeError | `1` / `1` |

Это четыре реальные caught consumer boundary errors, не обещание «browser errors 0». Minified message содержит `e.slice is not a function`; source anchor — receiver-provided `value.slice()` в `cloneSpine`. Ошибка не выведена из одного notification counter: actual DOM graph consumers broken, scalar/raw controls работают. Browser tab, React roots, watches и собственный server закрыты. Receipt/visual proof — `.rush/stdin/r44-parent-browser-proof.json`, `r44-browser.webp`; temporary source inputs сохраняются как data, не как production UI.

## Почему это новые findings

- S01 — supported initial array prototype и partial spine copy; не прежний SameValue или prototype-replacement defect.
- C01 — M bare leaves отдельных stores в K flattened dictionaries; ни `parts`, ни старый accumulated-prefix copy, ни dependency membership search не участвуют. Dictionary-level reuse требует immutable encoded/native producer proof; просто leaf dedup не устраняет K·M enumeration.
- C02 — useless observed eligibility scan, не два обязательных unobserved atomic rollback checkpoints R43-C01.
- A01 — stopped selection closure `snapshotAttempt`, не repaired raw tracked-view route. Subscription cleanup не доказывает освобождение props ownership.
- A02 — interop global snapshot value, не native `announced` checkpoint. Один stale result на alive source — не unbounded publication history и не strong source-key leak.
- S02 — endpoint ownership после принятого opacity, не scalar-only fold search; authoritative snapshots/writer cloning остаются нужными.
- S03 — post-install scalar proof context, не selection graph policy и не запись history patches.
- R-01 — user-code coercion boundary после первоначальной ownership check; это не repaired abort-listener eviction hint. `setData` до settlement deliberately не отменяет request и остаётся отдельным contract control.
- R-02 — ready completion objects, не key serialization или loader work. Promise identity observable; per-cache/global sharing и callbacks имеют разные риски.

## Направление реализации и будущие benchmarks

1. **S01 correctness первым:** preserve supported prototype, holes/own-undefined, unchanged row identity, SameValue и sharing/cycle fallback. Не suppress TypeError, не отключать patching для всех таких arrays и не объявлять intrinsic `slice.call` достаточным prototype proof.
2. **R-01 acceptance:** повторная captured-owner/generation/runtime check после effectful error description; сохранить raw falsy error provenance, replacement request/restore, benign operational COW и accepted active-request setData contract. Никаких retries, generic normalization или swallowed rejection.
3. **A01/A02 lifetime:** ownership identity не равна ownership всей props/result graph. Preserve suspended/abandoned attempt guard, committed layout-before-passive, scalar equality, live-value publication tokens и stable warm snapshots. Per-hook/WeakRef designs имеют allocation/identity tradeoff; SSR не имеет disposer.
4. **C01/S02 scaling и C02/S03 cheap work:** lazy internal reuse/early verdict only after eligibility/markers. Не ослаблять foreign metadata normalization, native protocol classification, structural replay adoption или graph topology checks.
5. **R-02 отдельно:** сначала оценить observability fresh Promise reuse и цельную completed operation; не менять public load на sync void или добавлять ещё один method ради micro-gain.

Proposed families, **пока не созданные**: `selection44/array-spine-prototype`, `resource44/error-description-ownership`, `components44/selection-attribution-lifetime`, `hooks44/computed-snapshot-lifetime`, `computed44/repeated-flat-snapshot`, `computed44/observed-baseline-eligibility`, `history44/after-opaque-endpoints`, `history44/scalar-final-proof`, `resource44/ready-completion`. Каждый topical report задаёт positive/cheap/lifetime/error controls и no-regression constraints. Existing 471 gates/296 historical entries, IDs/args/thresholds не меняются этим review.

## API решение и границы проверки

Подтверждённого основания для нового public cleanup/retry/alias/query knob либо удаления supported class/hook/computed adapters нет. Capability различия отражены в existing callers/declarations; простое направление — внутренний ownership/work cutover. Public signature/caller migration не предлагается; LSP в agent sessions недоступен, source/reference completeness внешних consumers не утверждается.

Не выполнялись full tests, build/lint/typecheck/formatters, benchmark runner/sweep, new CI, A/B implementation, heap-byte/CPU/InstructionRetired измерения или hardware/UAC. React lifetime proof — React19 ESM-production, не React18/Suspense/StrictMode/client A02 matrix; browser S01 — dense arrays, sparse и four-format coverage отдельно Node. Счётчики/WeakRef targets не переводятся в bytes/FPS/latency. Реальные API simplifications и отсутствие universal regressions нельзя вывести из числа exports или зелёного baseline CI.

## Scope commit

Назначенные reports: [Computed](api-engine-review-round-44-computed-2026-10-12.md), [React API](api-engine-review-round-44-react-api-2026-10-12.md), [Selection/history](api-engine-review-round-44-selection-2026-10-12.md), [Resources](api-engine-review-round-44-resource-2026-10-12.md). Parent делает один scoped local commit пяти Markdown files; agents не коммитили. `.claude/scheduled_tasks.lock`, shared dependencies, current dist и чужие worktrees не включаются и не удаляются. Frozen baseline и raw receipts остаются ignored reproducibility artifacts; временные executable scaffolds удаляются после proof. Push не выполняется без отдельного запроса.

## Реализация R44 и опциональный hook-free линтер

Разделы выше фиксируют исходный review-only результат базы `acfd3e2b8e58` и report commit
`0cadeeb9bd93`. Последующая реализация сохраняет публичные store/computed/resource signatures:
новый cleanup/retry/query knob не добавлен. Исправления собраны в отдельном integration-worktree.

### Лично проверенные механизмы

| ID | Наблюдение после исправления | Сохранённая граница |
|---|---|---|
| R44-S01 | Все три array prototypes доставляют edit в graph watch, graph/scalar hooks и graph/raw classes; 12 DOM outputs показывают `1`, browser errors отсутствуют | Holes, own-undefined, unchanged rows, alias/cycle selection policy |
| R44-R-01 | Restored Success и replacement request переживают effectful rejection description | Current runtime/generation, accepted `setData`, operational COW, raw falsy errors |
| R44-A01 | Все четыре obsolete props targets collectible при alive mounted owner и нуле active subscriptions | Re-arm, committed/abandoned attempts, hidden-write silence, warm registration reuse |
| R44-A02 | Native/external SSR sources освобождают obsolete hook result; current/caller-held controls остаются живы | Stable active snapshots, client commit boundary, live publication tokens |
| R44-C01 | K16/M16 flattened leaf entries/UIDs: **256→16**; dictionary enumerations: **16→1** | Trusted native snapshot provenance; foreign/overlap/version-pair fallback |
| R44-S02 | N32/K3/native-middle after-opacity reflection: **136→0**; unused owned nodes: **34→0** | Required snapshots, replay attribution, structural marker adoption, plain positive |
| R44-C02 | M32 observed pre-body baseline key calls/entries: **1/32→0/0** | Cold/unobserved/after-release eligibility, equality rollback, publication values |
| R44-S03 | P64 scalar undo и redo: **128→0 graph WeakMaps** каждый; graph positive остаётся 2 | SameValue, full endpoints, topology bijection, sparse/native capabilities |
| R44-R-02 | H32 ready hits: **32→1 completion identities** на cache; H0 не создаёт её | No loaders/publications/callbacks, async independent reactions, real request promises |

Это controlled work/ownership observations, не heap-byte, InstructionRetired, FPS или
универсальный latency claim. Cached no-work Promise identity больше не идентифицирует отдельный
`load()` call; `async_hooks`/Promise instrumentation видит меньше root initializations.
[Публичный контракт](promise-cache.md#the-public-surface) документирует эту границу.

A02 — lifetime tradeoff, не сокращение всех allocations: один новый shared envelope получает
один `WeakRef`. Construction probe наблюдает 21 `WeakRef` на initial read и 20 publications,
ноль на 100 warm renders, одинаково для 1/4/8 consumers. Timing этого route измеряется отдельно.

### Permanent benchmark coverage

Шесть автоматически обнаруживаемых gate-файлов добавляют **281 entry**: `computed44` — 120,
`history44` — 134, `selection44` — 6, `components44` — 4, `hooks44` — 13, `resource44` — 4.
Общий manifest содержит **752 entries**; `--lint-gates` сообщает 0 problems. SHA-256 всех
56 исходных gate-файлов совпадают с frozen contract: 471 прежний entry не переписан и не ослаблен.
Счётчики/collectibility исполняются отдельно от uninstrumented completed-operation timing.

### Hosted verification

Все новые тяжёлые прогоны выполняются только на GitHub-hosted runners: build/typecheck/lint,
React 18/19, native/platform packages, packed Oxlint/ESLint consumers, Chrome и benchmarks.
Локальный `bench:ci` orchestration запрещён самим runner; версии и зависимости не повышались.
Обычный [CI для f6c6996](https://github.com/PHPCraftdream/ReactCarburetor/actions/runs/38380384798)
завершился успешно. Это не означает отсутствие performance regressions.

[Девять samples и all-format calibration](https://github.com/PHPCraftdream/ReactCarburetor/actions/runs/38337735308)
подтвердили все 72 baseline/fix mechanism cases, но сохранили 11 старых timing flags и heap-byte
failure на обоих revisions. Порог старого `savedBytes <= 60` не менялся.

[Root relocation control](https://github.com/PHPCraftdream/ReactCarburetor/actions/runs/38356933772)
перенёс те же байты в equal-depth/equal-length directories. Все 10 focused targets прошли
старые behavior/work gates и timing thresholds по nine-sample medians; code changes при
переносе отсутствуют. Исходные пять timing flags и React A/A alert сохранены. Это доказывает
path/startup confound, а не универсальное отсутствие latency regressions.

[Полный aligned прогон](https://github.com/PHPCraftdream/ReactCarburetor/actions/runs/38360790636):
752 current entries — 0 behavior/work violations; 471 original contracts на каждом revision —
0 violations; 129 completed-operation controls — 0 semantic violations. Все 80 all-format
baseline/fix calibration cases приняты. Порог 25% + 0.05ms и 56 original gate hashes неизменны.
Прямой M1 capture больше не копирует leaf metadata через `Object.values`: **1→0 arrays**
относительно `769c2a5`, с independently observed positive **1** во всех четырёх форматах.
Guard входит в прежние 12 eligibility entries; общий entry count не искусственно увеличен.

Ниже nine-sample medians и полные min–max ranges, production ESM, milliseconds.

| Completed operation | Baseline | Fixed | Fixed/baseline |
|---|---:|---:|---:|
| C01 K16/M16 aliases update+get | 0.0740 [0.0706–0.0965] | 0.0419 [0.0384–0.0463] | 0.57 |
| C02 M32 observed update+get | 0.0753 [0.0666–0.0829] | 0.0706 [0.0642–0.0782] | 0.94 |
| S03 P64 repeated undo | 0.1859 [0.1697–0.2078] | 0.1629 [0.1439–0.1734] | 0.88 |
| S03 P64 repeated redo | 0.1356 [0.1197–0.1430] | 0.1407 [0.1304–0.1574] | 1.04 |
| Ready-cache complete await workload | 7.57 [7.12–8.20] | 7.28 [6.70–9.84] | 0.96 |
| Ready-cache complete then workload | 5.44 [4.81–5.70] | 5.85 [5.39–8.50] | 1.07 |

Полный timing job завершился failure: один original и четыре new alerts сохранены, а не
переклассифицированы по удачному отдельному sample. Независимый matched-layout A/B и
byte-identical A/A подтверждает или отвергает устойчивость этих alerts отдельно.

| Initial timing alert | Baseline ms | Fixed ms | Ratio |
|---|---:|---:|---:|
| `writelog39/bound-write-hook@10000` related write | 0.1687 [0.1558–0.2338] | 0.2226 [0.1660–0.2653] | 1.32 |
| `selection44/timing@M8-L64` dense array graph | 1.22 [1.12–1.62] | 1.54 [1.15–2.20] | 1.26 |
| `selection44/timing@M8-L64` sparse array graph | 0.7807 [0.7224–1.2520] | 1.15 [0.71–1.52] | 1.47 |
| `selection44/timing@M8-L65536` null sparse scalar | 0.6367 [0.5694–0.8024] | 0.8629 [0.8134–1.0118] | 1.36 |
| `selection44/timing@M64-L65536` object dense scalar | 0.4967 [0.4303–0.8097] | 0.7608 [0.4603–0.8620] | 1.53 |

[Независимое подтверждение](https://github.com/PHPCraftdream/ReactCarburetor/actions/runs/38380384986):
каждый путь исполнялся ещё на 9 samples для baseline/fix и двух byte-identical current copies.
Ни один из исходных пяти alerts не повторился; original hook write дал
0.1894 [0.1537–0.2618] → 0.2015 [0.1584–0.2280] ms и прошёл тот же threshold.
При этом появились два других A/B alerts и шесть A/A alerts; все raw samples и flags сохранены.
Следовательно, устойчивое ухудшение не подтверждено, но micro-latency этих selection lanes
остаётся неопределённой из-за runtime variability. Полный strict timing workflow **не назван
зелёным**: его initial failure сохранён. Behavior/work contracts и обычный CI прошли.


### Поставляемая опциональная архитектурная политика

`react-carburetor/lint` предоставляет дополнительный `configs['no-hooks']`; Oxlint получает
отдельный exported JSON preset `react-carburetor/lint/no-hooks.oxlintrc.json`.
`recommended` оставляет `no-react-hooks-in-components` выключенным. Native CLI включает правило
явным `--rule=carburetor/no-react-hooks-in-components=error`.

Правило использует OXC semantic binding identity, а не префикс имени локальной функции:
React imports/CommonJS, namespaces, literal members и ограниченное alias forwarding сохраняют
provenance; local shadows, другие модули и `this.useCarburetor()` не запрещаются.
Checked owners: PascalCase/JSX functions, `memo`/`forwardRef`, anonymous default exports и
recognized component classes. Dynamic/cross-module wrappers не анализируются.

Лично выполнены 12 focused native cases, весь native suite (361 unit + 24 CLI cases), release
binary default/opt-in smoke и реальные Oxlint/ESLint hosts с точными тремя diagnostics.
Статическая policy не доказывает zero allocations/GC: React и пользовательский render могут
аллочировать без hooks. Setup и ограничения — [rules.md](rules.md#hook-free-components-optional).

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

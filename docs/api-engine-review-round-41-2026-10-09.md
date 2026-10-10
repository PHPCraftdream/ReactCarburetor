# API и движок: ревью, раунд 41 — 2026-10-09

## Вердикт

База: рабочее дерево поверх `fb8b77c1d14dec246f058c27104c78d46395a66a`, с незакоммиченными исправлениями R40. Это **не** ревью одного только HEAD. На старте: 85 изменённых tracked файлов, 25 untracked, staged пуст. Чужие изменения не изменялись и не включаются в коммит этого отчёта.

Из текущих исходников собран отдельный build `worktrees/r41-probes/dist/{esm,cjs,esm-prod,cjs-prod}`: 187 модулей на формат. Основной `dist/` не перезаписывался.

Четыре подтверждённые находки: один оставшийся P1-пробел интеграции R40 и три новые P2-проблемы. Главные новые выигрыши — освобождение obsolete observer baseline, устранение квадратичного membership-поиска и стабильная передача resource data memo-child.

| ID | Приоритет | Область | Подтверждённый результат |
|---|---|---|---|
| R41-01 | P1 | API / correctness; оставшийся R40-01 gap | Экспортированный `Computed` оставляет 19 обычных engine-имён. Subclass `uid = 'total'` компилируется strict и ломает downstream computed: сумма остаётся 3 вместо 4, delivery 0 вместо 1 |
| R41-02 | P2 | Computed / retention | После последней отписки и нового scalar `get()` старый projection из 10k строк удерживается `announced`; исчезает лишь после новой подписки. Прототип очистки baseline освобождает его сразу |
| R41-03 | P2 | Computed / O | При переключении всех D source read sets `fresh.includes(cuid)` делает D(D+3)/2 сравнений. D=500/1000/2000: 125750/501500/2003000. Set-прототип сохраняет values/deliveries и убирает квадратичный член |
| R41-04 | P2 | Resource hook / renders / allocations | Неизменные `resource.data` получают новый read-proxy на parent render: memo-child 1→2 вместо class-control 1→1. На 1000 attempts: 8000 accessor-property definitions и 1000 WeakMaps; реальное обновление данных остаётся корректным |

R41-01 — не новый общий механизм shadowing: это конкретный оставшийся экспортированный класс вне завершённого R40 naming cutover. Остальные три не являются перепечаткой находок R38–R40.

## Метод и границы доказательств

- Node v24.12.0, `NODE_ENV=production`; public exports отдельного current-tree build.
- React/ReactDOM 19.3.0, JSDOM 30.0.1, `createRoot` + `flushSync`.
- Resource render finding дополнительно проверен в реальном Chromium: кнопка unrelated parent prop и кнопка refresh; screenshot и counters, browser errors 0.
- Strict TypeScript consumer проверен против `.d.ts` этого build, не source imports.
- Счётчики: реальные delivered values, render counts, descriptor/property definitions, WeakMap constructors, membership comparisons и WeakRef collectibility.
- Timings: три процесса на variant/размер, порядок baseline/prototype чередовался; в каждом семь переключений read sets. Это диагностика общей операции, не gate на latency.
- Membership instrumentation запускалась отдельно от timing A/B, чтобы стоимость счётчика не попадала в time claim.
- Prototype меняет только копию readable generated modules в `worktrees/r41-probes/prototype/esm`; product source, tests, версии и зависимости не менялись.
- Full tests, полный набор бенчмарков, packed matrix и CI в этом review не запускались. Зелёные результаты из resolution R40 не выдаются за проверки R41.
- Sub-agents не запускались. Managed Chromium tab и собственный сервер закрыты.

## R41-01 — P1 — naming cutover не охватывает экспортированный Computed

### Public repro

```js
class NamedComputed extends Computed { uid = 'total'; }
const a = new Store({n: 1});
const b = new Store({n: 2});
const first = new NamedComputed(read => read(a).n);
const second = new NamedComputed(read => read(b).n);
const sum = computed(read => read(first) + read(second));
const id = sum.subscribe(onChange);
sum.get(); // 3
b.put(3);
sum.get(); // 3, должно быть 4; onChange не вызван
```

`Store.put` вызывает обычный protected `update`. Без `uid` override тот же repro даёт 4 и ровно одну delivery.

| Variant | Начальная сумма | После b=3 | Deliveries |
|---|---:|---:|---:|
| Нативные engine ids | 3 | 4 | 1 |
| Два Computed с domain uid `total` | 3 | 3 | 0 |

Strict consumer `class NamedComputed extends Computed<number> { public uid = 'total'; }` проходит `tsc`. Инстанс содержит 19 own plain names, включая `uid`, `version`, `value`, `valid`, `dependencies`, `versions`, `announced` и callback fields.

### Механизм и source

- [`Computed.ts:62–125`](../lib/src/Carburetor/Derived/Computed.ts#L62): state остаётся в обычных protected/private TS fields, `getUID()` читает `this.uid`.
- [`Computed.ts:221–258`](../lib/src/Carburetor/Derived/Computed.ts#L221): collection keyed по `':' + source.getUID()`. Два источника с одним uid становятся одним dependency edge.
- R40 resolution перечисляет `Carburetor`, resource classes и `AntiHookComponent`; этот класс не перенесён. Поэтому это remaining cutover gap, а не утверждение, что уже исправленные store/component cases снова сломаны.

### Направление и acceptance

- Применить тот же недоступный subclass naming storage к `Computed`, без новой второй конвенции. Учесть ES2020 target: R40 уже отказался от lowering `#private` в WeakMaps.
- Оставить небольшой документированный subclass contract или явно закрыть subclassing; не скрывать engine/domain collision lint-предупреждением вместо исправления identity.
- Repro выше: strict compiles, sum=4, delivery=1. Проверить также domain `version/value/valid`, rollback attachment, native/external dependencies и cross-format computed graphs.
- Gate — public consumer values/deliveries; нельзя ограничиться отсутствием plain names.

## R41-02 — P2 — obsolete observer announcement держит старый projection

### Repro и GC control

```js
const c = computed(read => read(store).large
  ? Array.from({length: 10000}, (_, id) => ({id, label: 'row-' + id}))
  : 0);
const id = c.subscribe(() => {});
const old = new WeakRef(c.get());
c.unsubscribe(id);
store.run(d => { d.large = false; });
c.get(); // 0
// После job boundaries и 8 gc(): old всё ещё alive.
```

Computed и store остаются живы. Старое значение не держится переменной, только WeakRef. Повторная подписка на уже scalar значение делает старый projection collectible.

| Variant | Новый get() | Старый projection unobserved | После новой подписки |
|---|---:|---|---|
| Current | 0 | held | collected |
| Prototype: clear obsolete announcement | 0 | collected | collected |

Результат повторился в двух отдельных процессах на variant. Это reachability, не измерение удержанных bytes.

### Механизм и source

- [`Computed.ts:185–195`](../lib/src/Carburetor/Derived/Computed.ts#L185): last unsubscribe вызывает `releaseDependencies`, `valid=false`.
- [`Computed.ts:420–435`](../lib/src/Carburetor/Derived/Computed.ts#L420): dependency subscriptions снимаются, slots очищаются, но `announced` не освобождается.
- [`Computed.ts:261–285`](../lib/src/Carburetor/Derived/Computed.ts#L261): unobserved recompute заменяет `value` и `versions`, не observer baseline.
- `announced.value` остаётся старым array; `announced.versions` также может удерживать уже неактуальные sources. Повторная подписка заменяет baseline на новый value.

### Направление и acceptance

- Закрывать observer baseline при переходе к нулю subscribers, сохранив независимость evaluation cache и announcement во время активной wave.
- Прототип одной очистки в `releaseDependencies` доказывает механизм, но не является проверенным production fix.
- WeakRef old projection collectible при alive computed/store и scalar current value. Повторная подписка и real edit доставляются правильно; queued/reentrant settlement и failed attachment не возвращают obsolete baseline.
- Runtime probe с GC оставить отдельным perf/liveness gate, не недетерминированным ordinary unit test.

## R41-03 — P2 — fresh dependency membership квадратичен

### Repro

Один observed computed читает control flag и D stores. Каждый store содержит `left=1`, `right=2`. Переключение flag меняет read set каждого source с left на right, не их state/identity.

Все результаты корректны: суммы D/2D чередуются, семь переключений дают семь deliveries. Проблема — цена attachment bookkeeping.

| D stores | includes calls на switch | String comparisons |
|---:|---:|---:|
| 500 | 501 | 125750 |
| 1000 | 1001 | 501500 |
| 2000 | 2001 | 2003000 |

D fresh ids ищутся линейно из цикла по D+1 collected sources. Control source не fresh и полностью сканирует список; итого D(D+3)/2.

### Timing prototype, без instrumentation

Прототип сохраняет ordered `fresh` для setup/rollback и добавляет Set для membership. Медиана трёх чередующихся процессов, в каждом семь switches:

| D | Current whole switch, ms | Set prototype, ms |
|---:|---:|---:|
| 1000 | 18.6499 | 15.9481 |
| 2000 | 36.6700 | 28.8702 |
| 4000 | 92.9222 | 64.9483 |

Другой линейный setup/release/recordVersions остаётся, поэтому не обещается квадратичное ускорение всей операции. Counter — основной claim; observed whole-operation выигрыши около 14/21/30 % в этих сериях.

### Source и acceptance

- [`Computed.ts:310–325`](../lib/src/Carburetor/Derived/Computed.ts#L310): `for Object.keys(collected)` вызывает `fresh?.includes(cuid)`.
- [`Computed.ts:389–409`](../lib/src/Carburetor/Derived/Computed.ts#L389): `diffDependencies` формирует array fresh ids.
- Membership должен быть O(1) на edge или записываться при diff; порядок subscription/rollback должен сохраниться. Для tiny fresh list можно избежать отдельного Set.
- Gate по deterministic comparison/work counter для D sweep; retained-edge control не должен churn subscriptions. Все values, deliveries, failure rollback, live late reads и source replacement сохраняются.

## R41-04 — P2 — resource hook ломает memo data identity и пересоздаёт read machinery

### Public consumer

```jsx
const Child = React.memo(({data}) => <span>{data.name}</span>);
function Parent({tick}) {
  const resource = useResourceValue(cache, 'user');
  return <Child data={resource.data} />;
}
```

Cache заранее loaded, TTL=Infinity, data не меняется. Parent получает новый unrelated `tick`. Child всё равно рендерится из-за нового data proxy. Контроль — та же передача data через class `this.useResource(cache, 'user')`.

| Operation | Hook memo-child count | Class memo-child count | DOM |
|---|---:|---:|---|
| Mount | 1 | 1 | Ada |
| Unrelated parent prop | 2 | 1 | Ada |
| Настоящий refresh Ada→Grace | 3 | 2 | Grace |

JSDOM repro повторён; реальный Chromium показал те же counts, корректный refresh и 0 errors.

### Allocation counter

1000 resource render attempts при неизменной cache data, чтение `view.data.nested.n`, commit каждого attempt:

| Счётчик | Current |
|---|---:|
| Accessor-property definitions | 8000 |
| Definitions per render | 8 |
| Read-tree WeakMap constructors | 1000 |
| WeakMaps per render | 1 |

Checksum 1000; cache data остаётся Ada. Два процесса: 47.18/40.30 ms на 1000 attempts; это diagnostic time, без A/B speedup claim. Constructor/definition counts не являются total allocated bytes.

### Механизм и source

- [`useResourceValue.ts:21–31`](../lib/src/Interop/useResourceValue.ts#L21): resolve/render на каждом render.
- [`createResourceReader.ts:74–100`](../lib/src/Interop/createResourceReader.ts#L74): новый collector, record closure, field view, outer Proxy; `trackedData` локален attempt, `createReadProxy({data}, ...)` создаётся заново.
- [`ResourceCache.ts:348–385`](../lib/src/Carburetor/Resource/Cache/ResourceCache.ts#L348): field factory создаёт восемь own accessor properties, getter/setter closures на каждую; они захватывают resolution snapshot.

### Направление и существенный риск

- Сделать data identity стабильной при неизменном captured data и переиспользовать reader machinery; shared accessors могут убрать per-field closures отдельно.
- Не возвращать просто raw data ради скорости: это расширит dependency до целого data field и потеряет nested precision. Не делать старые snapshots динамически читающими новое resolution.
- Memo bailout перестаёт читать leaf в следующем attempt: сохранять ранее наблюдённые data dependencies при adoption стабильного snapshot, иначе после оптимизации появится stale child. Альтернатива — явный selector route с тем же immutable snapshot contract, что `useCarburetorValue`; это API tradeoff, а не однострочный fix.
- Acceptance: child count 1 после unrelated parent prop и 2 после refresh; nested unread changes не дают лишний render; mount/load только после commit, local view override, TTL, invalidation/rearm, unmount и abandoned attempts сохраняются.
- Gate на реальных React renders + DOM и machinery counters; class route — positive/control comparison.

## Порядок

1. R41-01: завершить защиту identity exported Computed, не маскировать неправильные values.
2. R41-02: освобождение observer-only памяти; проверить queued/reentrant edges.
3. R41-03: убрать квадратичный membership, сохранив setup/rollback order.
4. R41-04: сначала stable snapshot/dependency contract, затем accessor/read-tree reuse.

## Проверенные кандидаты, не объявленные выигрышами

- Flat object selections всё ещё создают descriptors/arrays/closures даже при zero graph WeakMap/WeakSet. Два primitive fields дают 4 descriptor lookups на equal selection; 128 watchers × 500 writes — 256000.
- Проверенный plain-object prototype сократил descriptors до 128000, values/callbacks правильные, но whole workload стал медленнее: 107.8232→129.7455 ms (медианы трёх alternating processes). Поэтому это **не** speedup finding и не рекомендация применять prototype. Arrays/sparse lane не менялась.
- Resource data refresh в actual probes не теряет updates; утверждается лишний parent-driven render, не stale-data bug.
- Proxy floor `activeCount`, React sibling-fiber O(N), coarse native leaves, array structural fallback, outer-spine copies и другие documented limits R39/R40 не перепечатаны как новые findings.
- R40 symbol storage и read-set pruning берутся как текущая база, не предлагаются повторно.

## Воспроизводимость

Все review-only probes/builds находятся в ignored `worktrees/r41-probes/` и не входят в коммит. Основные команды из caller repo root:

```text
node --expose-gc worktrees/r41-probes/computed-review.mjs worktrees/r41-probes/dist/cjs-prod lifetime
node worktrees/r41-probes/computed-review.mjs worktrees/r41-probes/dist/cjs-prod fanin 1000
node worktrees/r41-probes/computed-identity.mjs
node node_modules/typescript/bin/tsc -p worktrees/r41-probes/types/tsconfig.json
node --expose-gc worktrees/r41-probes/computed-ab.mjs worktrees/r41-probes/dist/esm lifetime
node --expose-gc worktrees/r41-probes/computed-ab.mjs worktrees/r41-probes/prototype/esm lifetime
node worktrees/r41-probes/computed-ab.mjs worktrees/r41-probes/dist/esm 4000
node worktrees/r41-probes/resource-consumer.mjs
node worktrees/r41-probes/resource-class-control.mjs
node worktrees/r41-probes/allocations.mjs worktrees/r41-probes/dist/cjs-prod resource
```

`computed-ab-results.json`, `flat-ab-results.json`, `browser-results.json`, `review-base.json` сохраняют результаты и source identity. Source SHA-256:

| Source | SHA-256 |
|---|---|
| `Derived/Computed.ts` | `b4db3d3da0f940a7b3514a889dff4c9b2ecc9800d6069c399c14f0c4101c5f51` |
| `Interop/createResourceReader.ts` | `b88c99826c14889332aa5fa815365fa31b725effa65bb45c565fc77020d3ce81` |
| `Interop/useResourceValue.ts` | `e11469673e44a21d894ed7bdb892383b5e4b8e9c5535592b951b4d2442959068` |
| `Resource/Cache/ResourceCache.ts` | `b325b39de53d2dcc4e098b86d68e2e9f15d8fbff61f44735b27309346e215583` |

Разделы выше — исходное ревью и исторические измерения, сохранённые report-only коммитом `81a5bb8`. Ниже — результат реализации и независимой проверки; исходные prototype timings не выдаются за новые замеры.

## Resolution — 2026-10-10

**Все четыре находки R41-01..04 исправлены и проверены исполнением.** База R40 сохранена отдельно в `fad07d684f4b55153883fa3cb10ab4dd86f40c84`. Реализация R41 выполнена в изолированном worktree; основной checkout не использовался агентами для изменений или тестов.

### Принятый контракт API

Пользователь разрешил breaking changes ради корректности и максимальной практической производительности. Независимый анализ `xa` подтвердил противоречие прежнего transparent proxy API: старый и новый aliases одного proxy дают одинаковые target/key/receiver, но требовали противоположного attribution.

Принят чистый переход:

```ts
useResourceValue<T, TArgs, R>(
    source: IResourceSource<T, TArgs>,
    args: TArgs,
    select: TSelector<IResourceView<T>, R>,
    isEqual?: TValueComparator<R>
): TReadonly<R>
```

- Selector обязателен; двухаргументного overload, default whole-resource selection и compatibility shim нет.
- Только synchronous selector/capture reads и loading dependencies владеют подпиской. Дочерние компоненты читают detached selection, не tracking proxy.
- Hoisted/memoized selector переиспользует значение и completed reads. Fresh inline selector исполняется заново; его стоимость измеряется отдельно.
- Возвращённые snapshots отделены от source и используют существующие equality/structural-sharing правила. Readonly — существующий immutable-by-contract контракт, не deep-freeze.
- Hook-result mutation/define/delete удалены. Локальное оформление — caller-owned overlay.
- Class `useResource` остаётся отдельным API с coarse data-field tracking и writable local facade. Для precise memo-child projection используется class `connectSelection`.
- Мигрированы все repository callers, R40/R41 tests, published type fixtures, packed consumers, старые benchmark scenarios и API docs.

### Реализация

| ID | Исправление | Независимое доказательство |
|---|---|---|
| R41-01 | Все engine state/method/callback slots `Computed` перенесены под module-private symbols; public source protocol остаётся явным subclass contract | Strict published declarations; 28 shadow-name cases × 16 source/consumer format pairs = 448; сумма 3→4, delivery 1 |
| R41-02 | Last release освобождает observer announcement и strong recorder filing; queued generations, reentrant teardown и rollback сохраняют независимый evaluation cache | Projection/source WeakRefs collectible при живых владельцах; resubscribe и edit доставляют 1; permanent liveness gate проходит три процесса |
| R41-03 | Fresh membership отмечается на dependency edge, без линейного `includes` и без дополнительного membership Set; порядок setup/rollback сохранён | D sweep, правильные суммы и 7 deliveries; retained tick не churn-ит subscriptions |
| R41-04 | Closed selector observations, committed/speculative separation, lifecycle token, detached structural sharing; shared explicit-resolution field factory и lazy local override storage | Реальные React/Chromium memo/DOM checks, closed-input и equal-result branch migration, allocation counters, SSR/loading/TTL/unmount и packed matrix |

### Детерминированные выигрыши

Ниже — actual current/frozen-public-consumer A/B, не перенос prototype timings из исходного ревью. Resource consumer читает одинаковые `name`/`nested.n`; DOM не меняется при unrelated parent props. До — прежний API, после — обязательный hoisted selector.

| Workload / counter | До R41 | После R41 |
|---|---:|---:|
| 1000 unrelated parent renders: дополнительные memo-child renders | 1000 | 0 |
| Те же 1000 renders: resource accessor definitions | 8000 | 0 |
| Те же 1000 renders: WeakMap constructors в stable-DOM window | 1000 | 0 |
| D=500, 7 dependency switches: membership comparisons | 880250 | 0 |
| D=1000, 7 switches: membership comparisons | 3510500 | 0 |
| D=2000, 7 switches: membership comparisons | 14021000 | 0 |
| D=2000: counted edge + membership work, включая retained tick | 14037008 | 16008 |

Checksum resource A/B — 1000 на обеих сторонах. Всего child renders: 1001→1. Current stable selector вызван один раз на mount и ноль раз в 1000-render window; subscription adds/removes в warmed window — 0/0.

Общая операция dependency switching всё ещё содержит линейные setup/release/version work. Здесь подтверждено устранение квадратичного membership-члена, не универсальный latency speedup.

Direct-flat object/array reevaluation теперь платит один collection Set и один tracking WeakMap; за 32 actual reevaluations — 32/32, Set-copy constructions 0. Constructed-flat equivalents имеют ту же стоимость. Graph control сохраняет отдельный selector footprint и copy ledger: 64 Sets и 128 WeakMaps за 32 reevaluations, current `31`, retained `Ada`.

Fresh inline nested projection в 1000-render scenario исполняется 1000 раз и строит 4000 WeakMaps; memo-child identity остаётся стабильной. Поэтому zero-machinery claim относится к stable-selector warmed lane, не ко всем selectors и не к total React allocation.

При изменении DOM attributes JSDOM сам добавляет WeakMap work: дополнительная exploratory A/B дала 2000→1000 общих constructors. Этот фон не называется engine read-tree allocation; stable-DOM A/B выше исключает его. Byte saving и новый wall-clock speedup не заявляются.

### Ошибки, найденные независимой интеграцией и устранённые

- Retired store удерживался через `live switcher data → cached read proxy → recorder closure → old recompute context → collected dictionary → dependency.source`. Heap snapshot снят до `WeakRef.deref()`. Recorder создаётся в отдельной symbol-keyed factory scope, содержащей только owner/slot; неизменённый public proof после исправления прошёл.
- Cached last resolution удерживал забытый payload. Instance-symbol ownership и reconciliation освобождают internal view/resolution при removal/eviction/restore/replacement/draft/settlement, не мутируя caller-captured resolutions. Permanent gate проверяет 10 маршрутов с live-cache, strong/captured controls.
- GC setup/precision writes в top-level suspended async benchmark frame удерживали loop temporaries. Synchronous returned setup исправил harness lifetime; 16 job/GC turns и все шесть retained views/source precision assertions сохранены.
- Восемь падений полного suite оказались obsolete private view-cache size pins. Они удалены, не переписаны `2→1`; public latest-value, untouched-view identity, synchronous removal delivery и memo-child behavior остались проверены. Целевой suite 18/18 и повторный полный 2530/2530 прошли.
- Удалены exact singleton-warning count/wording и helper length echoes; actual mixed-format graph/rollback assertions сохранены.

### Постоянные бенчмарки

**12 новых entries автоматически включены в общий `npm run bench`:**

```text
computed41/public-collision
computed41/observer-lifetime
computed41/dependencies-500
computed41/dependencies-1000
computed41/dependencies-2000
resource41/memo-data@1000
resource41/machinery@1000
resource41/dependency-precision
resource41/snapshot-lifecycle
resource41/class-positive-control@1000
resource41/inline-cost@1000
resource41/retention-live-cache
```

Полное сравнение manifests: все 241 прежние IDs/args/scenarios/gates/thresholds неизменны. Старые scenario callers мигрированы на новый API, но реальные writes, render/loader/DOM operations и acceptance сохранены. В частности, R40 50-reader mount/equal-refresh counts — 2/2, class unread-data control — 1, load-in-render/before/after commit — 0/0/1.

### Проверка

- `build`, четыре `tsc` projects, `check:layout`, type-aware lint — pass; у lint остались warnings, не errors. 188 modules на каждый runtime format.
- Full tests: **2530 passed, 0 failed, 0 skipped, 0 todo**, 257 files.
- Unfiltered benchmarks, **три samples на scenario: 253 entries, 0 failed, 0 violations** — 241 старый + 12 новых.
- Packed matrix: **16/16 pass, 0 skipped**; React 18/19, npm/pnpm, CJS/ESM, cross-format graphs, Next.js webpack/turbopack. Resource helpers также упражняют development/production export conditions.
- Real Chromium: 5 unrelated parents — hook/selected-class child 1; unread edit — 0 hook renders; observed leaf `Linus` — child 2; whole refresh `Grace` — child 3. Raw class control после whole replacement — child 2. Browser errors 0; managed tab и собственный server закрыты.
- Frozen pre-R41 gates отрицательны: collision final 3/delivery 0; obsolete projection held; dependency comparisons 880250/3510500/14021000. Resource retention baseline собирает 6/10 payloads. Новый combined resource scenario на старом build завершается ошибкой отсутствующего `reader.evaluate`; это API incompatibility, не timing/allocation proof. Отдельный equivalent public A/B выше доказывает render/machinery finding.
- Disposable current-build negative с потерей completed reads после bailout провалил assertion `memo bailout must retain the observed leaf dependency`. Product source и frozen distribution не менялись.

Receipts сохранены orchestrator в ignored `.rush/stdin/r41-final-receipts/`; benchmark scenarios/gates и этот resolution входят в scoped R41 commit. Remote CI и push в этом запросе не выполнялись.

### Publication / CI follow-up — 2026-10-10

`a2657f2` опубликован в `master`. Первый remote run
[38074088325](https://github.com/PHPCraftdream/ReactCarburetor/actions/runs/38074088325)
выявил два пропуска локальной матрицы: native source-text whitelist pin (349/350 unit tests)
и React 18 SSR diagnostics (2404/2407 engine/demo tests). Остальные jobs, включая packed
consumers и шесть platform packages, завершились успешно.

- `useResourceValue` сохраняет layout-phase commit на клиенте, а в Node SSR выбирает
  `useEffect`, который на сервере не выполняется. Console warnings не подавляются.
- SSR часть hydration tests теперь выполняется в отдельном настоящем Node process без DOM
  globals; затем missing/ready/invalidated snapshots гидратируются в JSDOM.
- Native override whitelist содержит только восемь public/protected имён. Шесть бывших
  engine-private имён после symbol cutover больше не маскируют обычные consumer helpers.
  Source-text test удалён; поведенческий regression проверяет реальные diagnostics.
- Local verification: resource40 **27/27**, resource41 **36/36**; окончательная изменённая
  lifecycle suite **9/9**. Real React **18.3.1** SSR + hydration: три состояния, stderr пуст,
  recoverable errors 0, loaders после commit 1/0/1, live subscriptions после unmount 0.
- Native **350 unit + 24 CLI tests passed**, Clippy all-targets `-D warnings` passed.
  Реальный CLI сообщил шесть ordinary-helper diagnostics и не сообщил diagnostics для
  `useEffects`, `unUseEffects`, `render`. Formatting трёх изменённых Rust files passed;
  whole-tree `cargo fmt --check` выявил существующие различия в нетронутых files — они не
  входят в CI gate и не переформатированы.
- Четыре build formats, четыре typecheck projects, type-aware lint и layout gate passed
  (существующие lint warnings сохраняются). Receipt: `.rush/stdin/r41-ci-fix-receipts.json`.

Следующий remote run относится к отдельному CI-fix commit; green conclusion подтверждается
GitHub Actions, а не этим локальным отчётом.

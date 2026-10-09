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

Отчёт описывает evidence и направления, не готовую реализацию. Коммит должен содержать только этот файл; push не запрошен.

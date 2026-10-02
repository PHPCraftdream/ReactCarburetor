# API и движок: ревью, раунд 31 — 2026-10-02

## Вывод

**Исходное ревью: шесть подтверждённых находок, P2 = 4, P3 = 2**, плюс предложение readable API.
В фазе исследования продуктовый код и постоянные тесты не менялись. Findings ниже сохраняют исходные
reproductions; выполненная реализация, исправления и итоговые gates описаны в разделе «Реализация раунда 31».

База: наблюдённый HEAD `d77a11b03d4d8e8924bae1187f1da006ee5c19ed`.
Проверялся текущий TypeScript source после реализации раунда 30, а не прежний dist.
Закрытые R30-01…10 не переобъявляются новыми находками. Known limit кеша native aliases при
чередовании двух roots также не считается новой находкой.

| ID | Приоритет | Область | Подтверждённая проблема |
|---|---|---|---|
| R31-01 | P2 | Equality / renders | Порядок primitive Map/Set теряется при equality; React оставляет устаревший DOM |
| R31-02 | P2 | Cache / O / allocations | `forgetAll` на non-configurable slots делает N whole-graph clones вместо одного |
| R31-03 | P2 | Selection / O | Sparse array из двух элементов проверяется по всей `length` при copy и equality |
| R31-04 | P2 | History / O / allocations | Отменённый scalar batch делает full capture и full graph equality |
| R31-05 | P3 | Renders | Два Invalid Date считаются различными; равная selection вызывает render |
| R31-06 | P3 | Cache / allocations | Memo primitive keys очищается целиком: последовательный рабочий набор 4097 keys даёт 100% misses |

Сначала исправлять R31-01: уменьшение renders не должно скрывать видимые изменения.
Главные новые возможности снизить асимптотическую работу — R31-02 и R31-03.

## Метод и границы доказательств

- Прочитаны installation/publication boundary, resource slot snapshots/restore, cache public API,
  load/settlement/invalidation/forget/eviction, graph ownership, history capture/cancellation,
  completed observations, class subscriptions, hook cache, selection equality/detachment,
  computed dependency/freshness paths и public source models.
- LSP references `sameSelection` подтвердили три consumers: watch, class `connectSelection`, hook
  `useCarburetorValue`; восемь references, включая declaration/imports/calls.
- Выполнены bounded реальные source consumers через Bun 1.4.2 с `NODE_ENV=production`:
  public watch, transaction/history, readonly bulk forget, sequential query resolution, sparse selection.
  Instrumentation временно считала actual `Reflect.ownKeys`, `hasOwnProperty` и `JSON.stringify`
  вокруг операции и возвращала оригиналы в `finally`. Счётчики ниже — операции, **не bytes**.
- Реальный ReactDOM `createRoot` + `flushSync` в JSDOM проверил hooks, class parent и memo child.
  Source consumer собран Bun с external packages, чтобы hooks и ReactDOM использовали одну React.
  Начальный direct-source harness и попытка runtime redirect не сработали из-за двух локальных React
  (`node_modules` и `lib/node_modules`); исправлен именно harness. Это не finding библиотеки.
- TypeScript probes транспилировались для выполнения, а не проходили отдельный typecheck.
  Полный project build, suites, lint, packed matrix и Chromium в этом раунде не запускались.
  JSDOM доказывает DOM/snapshot/render transitions, не визуальную поверхность браузера.
- Нет timing/throughput/heap-byte measurements, нет обещания speedup. Сложность выводится из
  исполненных счётчиков и соответствующих loops, а не из шумного wall clock.
- Throwaway harness удалён после проверки. Ни результаты прежних 1505 tests, ни benchmark gates
  раунда 30 не выдаются за проверку раунда 31.

## R31-01 — P2 — Map/Set equality пропускает изменение порядка

**Механизм.** `lib/src/Carburetor/Component/Connection/sameSelection.ts:105-160`.
`sameNativeContent` сравнивает Map по `has/get` для старых keys и Set по `has` для старых members.
Размер и membership совпадают независимо от insertion order. Комментарий в этом же файле говорит
о pairwise iteration-order comparison, но реализации такого сравнения нет.

`detachOpaque.ts:66-96` сохраняет iteration order в detached Map/Set. Поэтому suppressing snapshot
после reordering меняет наблюдаемое поведение: consumer, вызывающий `keys`, `values`, `entries` или
iteration, получает старую последовательность. Это не спор о descriptor flags и не unsupported
object-key matching: reproduction использует только string keys/members.

**Выполненный сценарий.** Selection `view => view.value`. Установить Map
`[['a',1],['b',2]]`, затем через public `setData` заменить на `[['b',2],['a',1]]`.
Аналогично Set `['a','b'] → ['b','a']`.

```json
{"native":[
  {"kind":"map","same":true,"events":[],"live":["b","a"]},
  {"kind":"set","same":true,"events":[],"live":["b","a"]}
]}
```

**Наблюдение настоящего React consumer:**

| Consumer | До → после renders | DOM после replacement | Live source |
|---|---:|---|---|
| Map hook | 1 → 1 | `a,b` | `b,a` |
| Set hook | 1 → 1 | `a,b` | `b,a` |
| Class parent | 1 → 2 | — | `b,a` |
| Memo child с selected Map prop | 1 → 1 | `a,b` | `b,a` |

Class parent действительно был уведомлён, но старую selection identity передал child.
Watch также не доставил ни одного callback. Снижение renders здесь ошибочное.
Контроли: тот же Map content/order даёт equal=true; changed Map value и changed Set member —
equal=false. Ошибка изолирована к наблюдаемому порядку, а не ко всем native changes.

**Рекомендация.** Сравнивать native entries/members в iteration order через intrinsics.
Для primitive keys/members использовать native SameValueZero semantics (`NaN` равен `NaN`,
`-0`/`0` не различаются как keys). Map values рекурсивно сравнивать текущим selection policy;
сохранить pair maps для cycles/alias topology. Object-key conservative policy не расширять.

History уже использует ordered intrinsic iteration в
`Tooling/Graph/sameHistoryGraph.ts:27-42`. Это образец traversal, но **не** повод использовать
history equality целиком: у history и selection разные descriptor/metadata контракты.

**Acceptance.** Map и Set reordering меняют watch value, hook DOM и memo child prop identity;
равные content + order сохраняют snapshot. Отдельно проверить primitive `NaN` keys, value cycles
и оба directions reorder. Ожидаемая complexity — O(entries), без structural object-key search.

## R31-02 — P2 — readonly bulk forget имеет квадратичный clone budget

**Механизм.**

- `Resource/Cache/State/Runtime/ResourceCacheState.ts:243-250`: `forgetAll` вызывает `forgetKey`
  для каждого key. `bulkDepth` coalesces delivery, но не preparation/copy.
- `:280-291`: каждый `forgetKey` вызывает `removeEntries([key], false)`.
- `State/Mutation/removeCacheEntries.ts:21-24` и `omitLockedCacheEntries.ts:9-18`: non-configurable
  dictionary slot требует whole operational graph clone с omitted key.
- `Store/Utils/Graph/cloneOwnedGraph.ts:65-98` сохраняет flags остальных slots. Следующий key всё
  ещё non-configurable, поэтому снова копируется весь оставшийся граф.

Для N settled entries с non-configurable dictionary slots посещаются
`N(N-1)/2` surviving entries плюс N roots/dictionaries. При payload размера D это
O(N²·D) вместо достижимого одного O(N·D) ownership pass. Повторяется и allocation копий,
хотя consumer получает только одну итоговую publication.

**Выполненный supported consumer.** Cache `ttl:Infinity,maxEntries:Infinity`, settled Success entries,
slots `enumerable:true,writable:true,configurable:false`, payload `{rowId,detail:{value}}`.
Затем public `forgetAll`; held root сохраняется для проверки restrictions/immutability.
Control отличается только `configurable:true`.

| N | Writable: roots / entry / row visits | Locked: roots | Locked: entry visits | Locked: row visits | Publications |
|---:|---|---:|---:|---:|---:|
| 32 | 0 / 0 / 0 | 32 | 496 | 496 | 1 |
| 64 | 0 / 0 / 0 | 64 | 2016 | 2016 | 1 |
| 128 | 0 / 0 / 0 | 128 | 8128 | 8128 | 1 |

Live dictionary пуст, held locked dictionary сохраняет все N entries. Functional result корректен;
находка именно о цене одного bulk operation.

**Рекомендация.** Удалять eligible settled keys одной preparation/removal операцией; readonly graph
owning и omitted-key Set нужны один раз. Начать с bulk path без active requests — это доказанная
форма выше. Не заменять whole-graph clone shallow spread: native root/entry backlinks требуют
единого ledger.

**Риск расширения.** Active requests имеют synchronous abort listeners, которые могут начать новый
request/restore и видеть intermediate state. Нельзя просто собрать старые keys и удалить всё после
abort: новый владелец должен выжить. Для этого пути нужен explicit bulk plan с exact request identity
и reentry checks; сохранить текущую корректность важнее безусловного fast path.

**Acceptance.** Доказанный settled readonly case — один graph ownership pass и одна publication;
held endpoint flags/values не меняются; native backlink graph сохраняется. При расширении на active
requests — reentrant reload survives, stale request не resurrects, failure identity и history undo/redo
сохраняются. Это новая bulk-cost находка, не повтор readonly invalidation R28.

## R31-03 — P2 — sparse selection работает по length, а не по populated indices

**Механизм.** `Component/Connection/sameSelection.ts:79-103` проверяет каждый индекс двумя
`hasOwnProperty`; `Store/Utils/Selection/detachOpaque.ts:99-136` копирует через loop по всей length.
Реальный sparse array из двух present slots получает тот же userland loop budget, что dense array.
Это особенно дорого в hook/class/watch selection: большой индекс или preallocated sparse range
становится стоимостью render/notification, хотя selected data почти пусты.

**Выполнено.** Arrays с indices `0` и `length-1`, остальные — holes. Проверены длина, два present
indices, сохранение hole и equality. Реальный watch выбирает
`({parity:view.marker % 2, rows:view.rows})`; replacement marker0→2 оставляет selection равной.

| length | Present slots | Detach index checks | Equality index checks | Actual watch wake checks | Notifications |
|---:|---:|---:|---:|---:|---:|
| 256 | 2 | 256 | 512 | 512 | 0 |
| 4096 | 2 | 4096 | 8192 | 8192 | 0 |
| 65536 | 2 | 65536 | 131072 | 131072 | 0 |

**Рекомендация.** Выделить sparse traversal по present own array indices, сохранив length, holes,
prototype, cycles и reference sharing. Copy должен различать hole и own `undefined`.
Equality сверяет present index sets и значения, а не каждый absent index. Enumeration должна
регистрировать structural dependency через существующие read traps; нельзя обходить recorder raw
target ради скорости. Non-enumerable indices и модель custom array fields требуют явной проверки
перед выбором `Object.keys` versus own-property names.

Цель — O(K) явных index checks для K present slots вместо O(length). **Не доказано**, что любой
JS engine enumeration имеет O(K): native array storage может оставаться holey dense. Dense fast path
не ухудшать; конечный выбор sparse/dense требует настоящего профиля и bounded paired benchmark.

**Acceptance.** При фиксированных двух slots число library index checks не растёт вместе с length;
добавление/удаление previously absent index wake-ит consumer; hole↔undefined, custom prototypes,
cycles и dense arrays сохраняют поведение. Нет задачи менять public array semantics.

## R31-04 — P2 — scalar cancellation в history оплачивает полный state

**Механизм.** `Tooling/CarburetorHistory.ts:350-374` сначала сравнивает endpoints pending paths,
но при равенстве всё равно вызывает `capture()` и `sameHistoryGraph(baseline,capture.state)`.
`capture` privately owns весь state (`:128-140`); full equality перечисляет обе стороны
(`Tooling/Graph/sameHistoryGraph.ts:46-57`). `buildEntry` вызывает этот путь начиная с двух patches
(`CarburetorHistory.ts:383-414`).

Пример — `transaction(() => {n=1; n=0;})` для уже существующего primitive field при большом
неизменённом plain rows payload. Scalar patches themselves достаточны для narrow proof, но текущая
проверка делает O(total state) traversal и allocates полную копию, чтобы не создать history entry.

**Выполнено.** Subclass считает actual `captureHistory` calls, instrumentation считает visits
к row objects. History подключена до операции; initial capture исключён из счётчиков.

| Rows | Scalar change: captures / row visits | Canceled scalar batch: captures / row visits | canUndo после cancellation |
|---:|---|---|---|
| 32 | 0 / 0 | 1 / 96 | false |
| 128 | 0 / 0 | 1 / 384 | false |
| 512 | 0 / 0 | 1 / 1536 | false |

Три visits на row = один ownership traversal плюс две стороны full comparison. Scalar change
control создаёт undo без full capture; canceled batch корректно оставляет n0 и пустой undo.

**Рекомендация.** Добавить узкий cancellation proof для patches существующих primitive leaves,
без insertion/deletion, ancestor replacement, array length/key-order/descriptor transitions,
opaque/mixed publication или exotic/restricted replay. Группировать по exact path, сверять исходный
и итоговый scalar endpoint/existence; сохранить full graph fallback для остальных случаев.
Это не общий отказ от topology/descriptor equality.

**Acceptance.** Доказанный n0→1→0 case не вызывает captureHistory после initial capture независимо
от размера unrelated rows; undo отсутствует. Fresh scalar batch сохраняет undo. Branch/key-order,
readonly/native graph, canceled array edits и deferred replay + fresh branch остаются в корректном
fallback до отдельного доказательства. Нельзя оптимизировать suppression flags вместо cancellation proof.

## R31-05 — P3 — Invalid Date приводит к лишним snapshots и renders

**Механизм.** `sameSelection.ts:105-107`: timestamps сравниваются через `===`.
У Invalid Date timestamp `NaN`, поэтому два одинаковых invalid dates считаются разными.
Detachment поддерживает их (`detachOpaque.ts:54-63`); это не class-instance policy.

**Выполнено.** `sameSelection(new Date(NaN),new Date(NaN)) === false`.
Watch выбирает равную parity плюс Invalid Date, marker0→2: callback count1 вместо0.
React hook с `{parity:tick%2,date}` после tick0→2 и replacement Invalid Date:

```json
{"before":{"dateRenders":1,"text":"0:NaN"},"after":{"dateRenders":2,"text":"0:NaN"}}
```

**Рекомендация.** `Object.is(Date.prototype.getTime.call(snapshot), Date.prototype.getTime.call(next))`.
History уже использует Object.is для Date timestamps (`sameHistoryGraph.ts:41-42`). Никакой новой
validation или нормализации даты не требуется.
Контроли выполнены: valid Date0/Date0 equal=true, Date0/Date1 equal=false.

**Acceptance.** Invalid→Invalid сохраняет reference, watch молчит, hook не перерисовывается;
Invalid→valid, valid→Invalid и разные valid times остаются видимыми изменениями.

## R31-06 — P3 — primitive memo имеет whole-cache performance cliff

**Механизм.** `Resource/Cache/ResourceCache.ts:29,145-166`: memo ограничен 4096 records и очищается
целиком при первом новом key после заполнения. Реальный sequential рабочий набор чуть больше лимита
снова сериализуется весь при следующем traversal. На miss вновь создаётся `{key,path}` и path string.
Предел памяти разумен; проблема — глобальное стирание reuse при одном crossing.

**Выполнено.** Последовательно `resolve(id)` для 0…N-1, затем второй такой traversal на том же cache;
`ttl:Infinity,maxEntries:Infinity`. Это valid read-only query-resolution path; loader не вызывается.
Счётчик охватывает только второй pass; checksum подтверждает actual key result.

| Distinct primitive keys | JSON.stringify во втором pass | Checksum |
|---:|---:|---:|
| 4096 | 0 | 8386560 |
| 4097 | 4097 | 8390656 |
| 5000 | 5000 | 12497500 |

R30-08 обещанный repeated primitive fast path работает ниже memo budget, но не сохраняется при
таком traversal. Это новая подтверждённая граница решения, а не повтор прежней serialization cost.

**Рекомендация / решение.** Сохранить bounded ownership; не делать unbounded Map для всех когда-либо
запрошенных args. Изолировать cold misses от стирания всех hot keys, либо предложить caller-owned
immutable query handle `{key,path}` с lifetime consumer, либо явный memo budget для workloads,
которым нужен такой tradeoff. Object args mutable-key contract не менять молча.

Простая замена clear на LRU **не гарантирует** hits при cyclic sequential N>capacity. Прежде чем
выбирать policy, проверить hot subset + cold query и above-budget sequential traversal. Для request
handle нужны explicit args immutability и source ownership; это API decision, не скрытый compatibility shim.

**Acceptance.** Memory bound документирован; one cold query не уничтожает весь hot set;
key escaping, undefined/null, NaN/Infinity, -0 и mutable object args сохраняют прежние keys.
Не заявлять zero allocations/100% hits для произвольного рабочего набора больше выбранного budget.

## API предложение — читать source без обязательного права писать и сериализовать

`useCarburetorValue.ts:127-130` принимает полный `ICarburetor<T>`.
`Models/Store.ts:69-110` включает mutation, snapshot/restore, wire tooling и watch.
Hook вызывает getVersion/getData/read/subscribe/unsubscribe, а не mutation API;
getUID остаётся частью общего subscription/source contract.

Реальный React consumer с facade ровно из этих шести bound methods смонтировался и читал selection.
Это runtime observation с type assertion в throwaway harness, **не** доказательство того, что текущий
публичный TypeScript API принимает такой объект без assertion.

Предлагаемый контракт — `IReadableCarburetor<T>`: subscription surface + getData/read;
`ICarburetor<T>` расширяет его state-write/tooling capabilities. Hook и подходящие class/derived
read-only entrypoints принимают узкий source. Это уменьшит обязательную поверхность custom adapters
и уберёт необходимость fake mutation stubs или unsafe casts у consumers.

Это capability split, а не обещание deep immutability raw `getData`. Не переносить автоматически все
entrypoints: tooling/history по-прежнему нуждаются в своих конкретных capabilities.
Перед реализацией — LSP references всех затронутых exported source types/callers и compile consumer
без unsafe casts. Публичное добавление interface и переэкспорт, generic inference и supported external
sources требуют contract review. Предложение не включено в число шести дефектов.

## Порядок следующей реализации

1. R31-01: ordered Map/Set equality, реальные watch/hook/class regressions.
2. R31-05 рядом с этим kernel: Invalid Date equality без новой date policy.
3. R31-02: settled bulk removal одним graph pass; отдельно доказать reentrant active-request path.
4. R31-03: sparse traversal с сохранением read tracking и dense-path performance.
5. R31-04: narrowly proven primitive cancellation fast lane, не global equality shortcut.
6. R31-06 и readable API split — после выбора memory/API contracts; затем measurement их workloads.

Нельзя объединять selection equality, history graph equality и operational ownership в одну функцию:
разные модели наблюдаемого значения — как раз причина необходимости отдельных proofs.
Не предлагать новые версии, глобальные retries, дополнительную validation или широкую архитектурную
перестройку под видом устранения этих конкретных costs.

## Минимальные reproduction recipes

Все imports ниже — от корня репозитория, выполнение через Bun с `NODE_ENV=production`.
Это recipes для source consumers, не сохранённая постоянная test suite.

### Native equality / watch

```ts
import {Carburetor} from './lib/src/Carburetor/index.ts';
const store = new Carburetor({value:new Map([['a',1],['b',2]])});
const events: unknown[] = [];
const stop = store.watch(view=>view.value, value=>events.push([...value.keys()]));
store.setData({value:new Map([['b',2],['a',1]])});
console.log({events,live:[...store.getData().value.keys()]});
stop();
// observed: events=[], live=['b','a']; заменить Map на Set для второго case.
```

### Readonly bulk clone count

```ts
import {ResourceCache,EResourceStatus} from './lib/src/Carburetor/index.ts';
import type {IResourceEntry} from './lib/src/Carburetor/Models/Resource.ts';
type Row = {rowId:number;detail:{value:number}};
const cache = new ResourceCache<Row,number>(
  async rowId=>({rowId,detail:{value:rowId}}),{ttl:Infinity,maxEntries:Infinity});
const entries: Record<string,IResourceEntry<Row>> = {};
for(let id=0;id<32;id++) Object.defineProperty(entries,cache.keyOf(id),{
  value:{status:EResourceStatus.Success,data:{rowId:id,detail:{value:id}},error:undefined,
    updatedAt:1,refreshing:false,invalidated:false,failed:false},
  enumerable:true,writable:true,configurable:false,
});
cache.setData({entries});
let roots=0,rows=0;
const ownKeys=Reflect.ownKeys;
Reflect.ownKeys=object=>{
  if(Object.hasOwn(object,'entries')) roots++;
  if(Object.hasOwn(object,'rowId')) rows++;
  return ownKeys(object);
};
try{cache.forgetAll();}finally{Reflect.ownKeys=ownKeys;}
console.log({roots,rows,left:Object.keys(cache.getData().entries).length});
// observed: roots32, rows496, left0; fixtures использовали все IResourceEntry fields.
```

Остальные recipes: existing scalar n0→1→0 внутри transaction с history после initial capture;
sparse array с length65536 и двумя slots + `sameSelection(detachOpaque(array),array)`;
два sequential `resolve` passes для 4096/4097 keys, счётчик JSON только вокруг второго pass.
Формы, counters и preserved outputs указаны выше; timing/byte thresholds из этих recipes не выводятся.

## Реализация раунда 31

Работа поручена четырём точным исполнителям `xl` в изолированных worktree на базе `72a72e2`:
selection kernel (01/03/05), cache (02/06), history (04), readable API. Интеграция и все project gates
выполняются основной сессией. Ни версии, ни зависимости не менялись; nested delegation и Rush не использовались.

### Принятые контракты

- Ordered intrinsic Map/Set equality, SameValueZero primitive keys/members и Object.is Date timestamps.
  Канонические raw identities используются для graph pairing; сами plain reads идут через view.
- Dense-prefix array traversal остаётся; при первой hole перечисляются present own numeric indices.
  Это сохраняет structural tracking, own undefined, holes, prototypes и selector-result cycles.
  Валидируемый state tree не получил разрешения на non-enumerable поля или plain cycles.
- Settled readonly `forgetAll` с base per-key hooks делает одну подготовку. Active-request и subclass
  override пути сохраняют per-key behavior и могут оставаться квадратичными на locked mixed sets.
- Primitive cancellation требует mutation-only publication, existing primitive endpoints и ordinary
  open own-data chains. Genuine root installs, arrays, exotic/restricted endpoints идут в graph fallback.
  Pure mutations coalesce в mutation fact, а empty-diff root install помечает уже-pending store/observer
  publications mixed. Самостоятельный metadata-only replacement не создаёт уведомление или undo.
- `keyCacheSize` — finite record budget, default4096, zero disables primitive memo; Infinity/fractional/
  negative/unsafe values rejected. LRU использует intrusive links в самом retained record, без
  отдельного node wrapper и без Map delete/set на hit. Это больше metadata на record, не byte budget.
  Cyclic working set выше capacity может полностью промахиваться; larger finite capacity выбирается явно.
- Public `IReadableCarburetor<T>` содержит шесть read/subscription capabilities. Hook, class readers и
  computed accept его без fake write/tooling methods. `getData` остаётся raw; type split не заявлен как speedup.

### Интеграционные находки и исправления

1. Первый history вариант ускорял только один update callback, но оставлял исходные два update внутри
   transaction на full capture. Исправлена mutation fact aggregation; исходный reproduction сохранён.
2. Empty-diff root install не учитывал queued observer после закрытия store publication.
   Actual deferred readonly-descriptor regression дал canUndo=false; теперь учитывается pending observer
   boundary без дополнительной publication, и регрессия проверяет оба metadata endpoints undo/redo.
3. Native facade/raw graph-pair identities расходились при repeated Map aliases и plain/native bridges.
   Actual comparison возвращала false для неизменённого графа; канонизация исправлена без bypass read traps.
4. Production-only smoke пропускал ошибку test fixture: hidden/cyclic array была положена в запрещённый
   plain state. Development regression выявила это; fixture теперь создаёт эту форму в selector result.
   AliasLedger не ослаблен.
5. Typed readable fixture выявил несогласованный mapped readonly return. Исправлен внутренний typed
   tracking overload, без consumer casts или suppression. React act promises теперь awaited.
6. Первый Map-order LRU дал measurable regression: warmed4096 second pass0.712→1.250 ms,
   default cyclic4097 pass2.641→9.119 ms (seven paired processes). Этот вариант не принят:
   Map hit reinsert и iterator eviction заменены intrusive LRU. Ordered Map entries tuples также удалены.
7. Полный suite обнаружил bypass protected `forgetKey` override в settled fast lane. Исправлена
   общая граница extensibility: override любого per-key forget/abort/remove hook сохраняет прежний
   путь. Исходный partial-clear/throw regression и новые readonly override/recovery cases прошли27/27.
8. Concurrent packed prepack удалял `dist` во время dual-format tests. Это ошибка orchestration,
   не повод менять библиотеку или скрывать missing-dist checks. После устранения concurrency
   dual-format suite прошёл3/3; итоговый полный suite запущен отдельно от rebuild.

### Уже наблюдённые acceptance proofs

- Три cache regressions действительно падали до source cutover: ownership32 вместо1, capacity1
  не соблюдалась, invalid keyCacheSize не отклонялся.
- Focused suite после fixture/typing correction: 36/36 в девяти файлах, без skips/todos/snapshot changes.
- Built CJS↔ESM dev/prod: 32/32 checks через public API; eight cases в четырёх направлениях.
- Sparse equal wake length65536/two slots: index checks131072→4; hole→own undefined реально уведомляет.
- Settled readonly32: roots32→1, omitted row visits496→0, publication1, held entries32.
- Scalar two-update cancellation: capture1→0; обычный последующий change сохраняет undo/redo.
- Hot64 после одного cold crossing: stringify64→0. Explicit capacity8192 для4097keys:4097→0;
  это новый явно выбранный memory budget, не доказательство default4097 warm hits.
- Chromium: reordered Map/Set и memo child показывают `b,a` (baseline оставлял `a,b`);
  равный Invalid Date сохраняет render1 (baseline2); sparse DOM65536:false→true;
  readable hook/class/computed следуют selected branch до3, old branch не перерисовывает;
  browser error entries пусты. Собственная поверхность закрыта после proof.

Reproducible measurements: `scripts/benchmarks/round31/{selection,cache,history,readable}.mjs`
принимают absolute production distribution root. `profile.mjs` измеряет V8 sampled allocation
estimates, включая workload setup, а не точные allocated bytes или retained heap.

### Итоговые парные замеры и ограничения

Node24.12.0, production CJS, frozen baseline `72a72e2` и интегрированный код. Семь чередующихся
before/after процессов на workload; script medians сведены медианой семи запусков. Timed driver
включает реальное создание/replacement/query lookup и проверки outputs; это не bare-helper ns.
Часть second-pass lookup также включает JIT cold path. Между сериями абсолютные timings заметно
плавали; все отрицательные controls ниже сохранены, общего throughput speedup не заявлено.

| Workload | Baseline median ms | Refactored median ms | Наблюдаемая работа |
|---|---:|---:|---|
| Sparse selection length256, два slots, 10 updates | 1.515 | 0.714 | kernel checks768→6 |
| Sparse selection length4096, два slots, 10 updates | 16.923 | 1.352 | kernel checks12288→6 |
| Sparse selection length65536, два slots, 5 updates | 188.324 | 10.877 | kernel checks196608→6 |
| Dense selection length256, 10 updates | 6.837 | 7.316 | checks768/768, own-key arrays0/0 |
| Dense selection length4096, 10 updates | 98.831 | 90.452 | checks12288/12288 |
| Dense selection length65536, 5 updates | 1335.076 | 1515.317 | checks196608/196608 |
| Settled readonly forgetAll32 | 15.250 | 0.470 | roots32→1, omitted entries/rows496→0 |
| Settled readonly forgetAll128 | 324.355 | 0.615 | roots128→1, omitted entries/rows8128→0 |
| Writable forgetAll32 | 0.400 | 0.429 | roots0/0, publication1/1 |
| Writable forgetAll128 | 0.809 | 0.995 | roots0/0, publication1/1 |
| Mixed active readonly forgetAll32 | 10.736 | 13.283 | roots31/31, visits465/465 |
| Mixed active readonly forgetAll128 | 237.895 | 290.933 | roots127/127, visits8001/8001 |
| Primitive memo first repeated scan4096 | 1.130 | 1.667 | stringify0/0 |
| Default cyclic primitive scan4097 | 5.704 | 8.350 | stringify4097/4097 |
| Explicit keyCacheSize8192 / scan8192 | 5.130 | 3.040 | stringify8192→0; baseline не поддерживает larger budget |
| Native512 same-order selection, 12 updates | 4.578 | 4.928 | notifications0/0; reordered snapshots теперь видимы |
| Scalar history cancellation, rows32 | 0.323 | 0.061 | capture1→0, row visits96→0 |
| Scalar history cancellation, rows128 | 0.894 | 0.057 | capture1→0, row visits384→0 |
| Scalar history cancellation, rows512 | 3.753 | 0.083 | capture1→0, row visits1536→0 |
| Ordinary scalar history, rows512 | 0.078 | 0.055 | capture0/0, undo/redo сохранены |

Sparse kernel counter включает copy + comparison; отдельный public equal wake proof даёт131072→4.
На полностью omitted simple cache graph payloads не посещаются вообще. С retained native backlinks
ownership по-прежнему проходит нужные reachable payloads один раз — это не zero-copy обещание.

Hot subset benchmark: восемь reheats после одного cold crossing требуют stringify9→1.
Readable adapter benchmark в обеих версиях: writes128, notifications64, selector evaluations65,
component renders65, final value `s32`, subscriptions после unmount0. Type-only capability split
не заявлен как изменение render count или performance.

**Цена policy не скрыта:** intrusive LRU убирает per-hit Map churn и отдельные eviction iterators,
но поддержание recency не бесплатное. Измеренный cyclic scan выше capacity остаётся хуже baseline;
configured larger capacity — явный memory/performance выбор. Dense/native controls и active fallback
тоже не дают основания обещать ускорение всех форм. Это ограничения выбранного bounded LRU/ownership
контракта, а не молча изменённые benchmark inputs или пропущенные cases.

### Allocation sampling

Три чередующиеся paired V8 HeapProfiler samples с interval4096 для одного bounded built consumer
workload (все восемь public cases). Sampled library self bytes median6123200→4246832 (~30.6% меньше),
total including setup19723744→12039728 (~39.0% меньше). Это **оценки sampling**, не точные bytes,
не retained heap и не обещание такого процента для любого application. Workload включает changed
native behavior и explicitly increased memo capacity; отдельно приписывать весь delta одной задаче нельзя.

### Наблюдённые итоговые gates

- Full suite: **1587/1587**,154 files, без skips/todos/snapshot changes; reported631437 ms.
- Typecheck: все четыре configs, включая relocated readable type contract.
- Layout: <=7 entries, <=600 physical code lines, один export/file.
- Lint: ноль ошибок,56 warnings; локальный scratch exclusion не внесён в config.
- Production/development build:142 modules в каждой distribution.
- Final packed matrix после subclass guard: **16/16**, без skips/failures (React18/19, npm/pnpm,
  CJS/ESM, strict mixed formats, Next16.3.5 webpack/Turbopack);390.41 s. Выполнена отдельно от suite,
  исходные consumer checks не ослаблены.

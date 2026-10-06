# API и движок: ревью, раунд 37 — 2026-10-06

## Вывод

**Шесть новых подтверждённых находок: P1 = 2, P2 = 3, P3 = 1.**
База — `27dce2818ed7dad818632f61e8e05524753d6b54`, интегрированный раунд36.
Номер найден по существующим отчётам: последний до этой работы —36.

| ID | Приоритет | Область | Подтверждённая проблема |
|---|---|---|---|
| R37-01 | P1 | Selection correctness | Incremental snapshot разрывает native/plain alias; hook/class DOM показывает stale linked value |
| R37-02 | P1 | History / observer API | Exception одного patch observer обрывает replacement patch batch; undo восстанавливает только первый leaf |
| R37-03 | P2 | Memory / read filing | Patched read sets сохраняют все ранее существовавшие paths при type-changing subtree replacement |
| R37-04 | P2 | O / latency | Private cap64 changed paths возвращает whole-list walk уже на65, независимо от размера selection |
| R37-05 | P2 | Allocations | Primitive reconcile создаёт graph ledgers, которые ему не нужны:3 WeakMap +1 WeakSet на wake |
| R37-06 | P3 | Class API / renders | Equal-valued conditional branch switch вызывает class render только ради переноса read set |

Сначала R37-01 и R37-02. Не следует повышать hit rate или сокращать renders, пока snapshot/undo
могут быть неверными. Остальные находки имеют отдельные cost/transition proofs; это не повтор
исходных full-list walks и ungated class selections из раунда36.

## Метод и границы

- Исходники прочитаны в актуальной рабочей копии: selection patch planner/apply/reuse,
  reconciliation ledgers, hook/watch/class observation lifecycle, notification-time class gate,
  root installation patch collection, patch fanout и history entry selection.
- LSP references `patchFromWriteLog`:7 refs, три consumer routes — hook, watch и class reuse.
- `npm run build` выполнен на этой базе:159 modules в каждой dev/prod CJS/ESM distribution.
  Пробы импортировали rebuilt **production ESM**, не старые dist и не текущий TypeScript через transpiler.
- Node `v24.12.0`; React/ReactDOM `19.3.0`; `NODE_ENV=production`.
- Реальные consumers: public watch, public setData, history undo/redo, protected update через subclass,
  реальные ReactDOM hook/class components в managed Chromium. Продуктовый код, постоянные tests,
  зависимости и версии не менялись. Подагенты не запускались.
- Для path cliff — три независимых процесса, одинаковые counters/output. Times ниже — ranges;
  машина shared, абсолютные ceilings и малые speedup ratios не заявляются.
- WeakMap/WeakSet constructors временно обёрнуты только вокруг actual update и возвращены в finally.
  Это exact constructor counts, **не allocated bytes**. Subscribe override фиксировал реальный
  переданный read set; его содержимое не менялось.
- Project suite, lint, packed matrix, heap-byte/CPU profiles и projected implementation не запускались.
  Сборка + реальные consumers — evidence этой review-фазы, а не новый zero-defect verdict.
- Known limits R30–R36 не переобъявляются: active/override readonly bulk fallback, cyclic key working
  set выше memo budget, cross-root alias cache, positional/structural full reconcile fallback,
  истории с native graphs и пределы perf harness остаются отдельными уже записанными ограничениями.

## R37-01 — P1 — patchable snapshot не сохраняет native/plain sharing

### Наблюдённое поведение

Валидное state tree с native leaf:

```js
const rows = [{id:'a', n:1, link:null}, {id:'b', n:1, link:null}];
rows[0].link = new Map([['row', rows[1]]]);
const store = new Store({rows});
store.watch(d => d.rows, (next, previous) => {
  // The graph in this detached selection must preserve the native/plain alias.
});
store.change(d => { d.rows[1].n = 2; });
```

Plain state не содержит direct aliases/cycles: sharing проходит через разрешённый native Map.
В исходном live graph `rows[0].link.get('row') === rows[1]` остаётся true.

Actual watch outputs для двух edits:

```json
[
  {"value":2,"linked":1,"alias":false,"heldValue":1,"heldLinked":1},
  {"value":3,"linked":1,"alias":false,"heldValue":2,"heldLinked":1}
]
```

Initial snapshots корректны. После первого edit новый snapshot имеет updated direct row,
но Map указывает на row из старого snapshot. Held previous values стабильны, однако topology
**нового** snapshot неверна.

В Chromium оба consumers — `useCarburetorValue(store, d=>d.rows)` и class `connectSelection` —
показали `1/1/true → 2/1/false`, хотя live alias true. Browser error entries пусты: это неверный
результат, не thrown exception.

Вторая допустимая форма: initial `link:null`, затем replacement существующего leaf на
`new Map([['row', store.getData().rows[1]]])`. Уже этот patch выдаёт alias=false; последующий row edit
оставляет linked value1 при direct value2.

**Положительные controls:** pure plain live list публикует2,3; primitive projection
`({direct:d.rows[1].n, linked:d.rows[0].link.get('row').n})` публикует2/2,3/3.
Projection `d.rows.map(row=>row)` не следует объявлять готовым обходом: проба дала корректный первый
callback2/2, но второй callback отсутствовал. Корректность полного alias reconcile тоже нужна в acceptance.

### Механизм

- `Store/Utils/Selection/reconcileSelection.ts:61-86,386-405`: initial pass с previous undefined
  уходит в `detachOpaqueInto`. Copy ledger действительно сохраняет aliases, но `ctx.shared` не получает
  информацию о sharing, обнаруженном detacher. Полученный trace ошибочно разрешает tree patch.
- `Interop/useCarburetorValue.ts:292-328` и `Tracking/Observation/watchSelection.ts:64-95` разрешают
  incremental route по этому patchable fact. После удачного patch eligibility не пересчитывается для
  introduced sharing (`patched || !trace.shared` в hook).
- `Selection/Patch/patchSelection.ts:44-74`: COW spine обновляет только named changed row и оставляет
  прежний Map object; native backlink в нём остаётся на старом copied row. Reconcile одного leaf с
  локальным ledger не доказывает whole-selection topology.

### Решение

Sharing/cycle/native-cross-boundary eligibility должно описывать **фактический** detached graph,
включая initial detach и изменённый subtree. До доказательства graph-safe incremental replay —
conservative whole-selection reconcile для cross-branch native sharing, а не специальные keys/rows.
Не подменять fix shallow copy native Map: он сохранит stale copied endpoint.

### Acceptance

Watch, hook и class: first and subsequent edits сохраняют alias=true и оба n=2→3; old snapshots
не меняются. Отдельно initial sharing, introduced/removed sharing, native root backlink, Map value/key,
Set member, cycles и reordered list. Full reconcile control обязан корректно доставлять второй edit.
Tree-only fast path должен остаться быстрым. Не выдавать «fallback включён» за законченную topology fix.

## R37-02 — P1 — observer exception делает replacement undo неполным

### Наблюдённое поведение

State `{x:0,y:0}`; независимая history и patch-only observer, который бросает `Error('observer-stop')`.
Public `setData({x:1,y:1})` бросает этот error, но оба поля уже установлены и publication закрывается.
Порядок регистрации history/throwing observer проверен в обоих направлениях.

```json
{"throwingFirst":false,"error":"observer-stop","patches":1,
 "installed":{"x":1,"y":1},"undo":true,"undone":{"x":0,"y":1},
 "redo":true,"redone":{"x":1,"y":1}}
```

Для throwingFirst=true результат тот же. History говорит undo=true, но y остаётся1 вместо0.
Control без throwing observer undo возвращает `{x:0,y:0}`.

### Механизм

- `Store/Transaction/installState.ts:62-66,90-102`: diff collects несколько detailed patches,
  root устанавливается целиком, затем `for (...) listener(patch)` находится внутри одного try/catch.
  Первый throw прекращает delivery **всего остального batch**.
- `Transaction/PatchObserverRegistry.ts:48-68` корректно доставляет один patch всем независимым
  observers, собирает error и rethrows. History получает первый patch даже при другом throwing
  observer, но последующих patches outer loop уже не доставляет.
- `Tooling/CarburetorHistory.ts:474-510`: public replacement теперь допускает patch entry.
  History не знает, что patch stream был обрезан, и записывает only x.

Это регрессия полноты new R36-04 patch protocol, не требование скрывать callback errors.

### Решение

Переиспользовать `Store/Tracking/Proxy/deliverPatches.ts:8-24`: он доставляет **все уже-applied**
patches, сохраняет first error и бросает его только после полного прохода. Preserve ordinary
publication/error ordering; не suppress original error и не rollback уже-installed root.
При недоказанной полноте patches безопасный history fallback должен own complete endpoints.

### Acceptance

Both observer registration orders: setData по-прежнему бросает original error, state полностью
установлен; undo/redo восстанавливают оба поля. Также observer бросает undefined, один throw среди
нескольких patches, independent histories, transaction/deferred publication, restore/fromJSON routes.
Не удалять throwing-observer contract и не ограничивать fixture одним changed field.

## R37-03 — P2 — incremental read-set union растёт с историей схемы

### Наблюдённое поведение

Watch выбирает live list из одного row: `{rows:[{payload:0}]}`. На каждом cycle existing payload
заменяется plain object с16 уникальными для этого cycle fields, затем снова primitive0.
Никакого роста live list, числа rows или конечного payload нет.

| Cycles | Final payload | Filed read paths | Delivered changes |
|---:|---:|---:|---:|
| 1 | 0 | 23 | 2 |
| 16 | 0 | 263 | 32 |
| 64 | 0 | 1031 | 128 |

Outputs/callback counts проверены assertions. Получается7 base paths +16 paths на каждый ранее
существовавший object payload; paths не освобождаются до full fallback/unsubscribe.

### Механизм

`Tracking/Observation/watchSelection.ts:37-45,85-87` и `Interop/useCarburetorValue.ts:320-328`
при patched pass объединяют filed reads с newly read paths, но не удаляют descendants заменённого
subtree. Object→primitive→new object diff даёт сам leaf path, без key-set marker, поэтому всё время
остаётся на incremental route. Class reuse имеет такую же union/adoption идею
(`Selection/Patch/reuseSelection.ts:60-72`), но численная growth-проба выполнена на watch.

Safety superset не означает bounded ownership. Retained Set/index buckets растут O(total historical
schema), а re-filing новых Sets повторно копирует всё накопленное. Это новый R36 consumer-level
retention, не R32 bounded per-handler path memo problem.

### Решение

Incremental read ownership нужен по patched subtree: удалить старые owned descendants при type/shape
replacement и добавить фактические новые reads, сохранив независимые selector reads. Консервативная
простая альтернатива — full reconcile/reset read set именно на type-changing subtree replacements.
Не «лечить» только Map eviction: read Set остаётся сильным владельцем paths.

### Acceptance

При фиксированном live shape footprint не растёт с cycle count; observer видит каждый replacement.
Selector reads вне replaced subtree, conditional branches, newly created child edit и late live
computed reads не теряются. Completed snapshot reads и deliberately extendable computed reads
не должны получить одну indiscriminate pruning policy.

## R37-04 — P2 — path cap64 создаёт whole-selection latency cliff

### Наблюдённое поведение

Plain rows `{id,n}`, public watch `d=>d.rows`, один update меняет K existing n leaves.
Сравниваются64 и65, без push/delete/length/key-order/native values. Везде ровно один callback,
ровно K rows с n1; source/read-path counters совпали в трёх независимых процессах.

| Rows | Changed leaves | Paths recorded on wake | Time range ms |
|---:|---:|---:|---:|
| 1000 | 64 | 129 | 1.719–2.083 |
| 1000 | 65 | 7007 | 18.788–24.178 |
| 4000 | 64 | 129 | 0.700–1.446 |
| 4000 | 65 | 28007 | 70.625–119.908 |

Control K1 —3 recorded paths; K128 снова whole walk7007/28007. Не изменились rendered/selected values;
изменились только объём library work и latency.

### Механизм

`Selection/Patch/planSelectionPatch.ts:7-8,22-33` использует абсолютный `PATCH_PATH_LIMIT=64`.
На65 matching paths возвращает undefined, после чего consumer выполняет whole reconcile.
Выбор не учитывает selection size, число touched spines или relative cost.

R36 documented structural fallback (`~k`, length) — другое: эта проба не меняет структуру.
R36 relative diff threshold не помогает, поскольку write attribution тут precise, а cliff находится
на уровне snapshot patch planner.

### Решение

Выбирать patch/full по work estimate относительно selected graph или touched containers;
coalesce общие spines, не превращать маленький batch на большой list в unconditional full walk.
Просто повысить magic number до65/128 — перенести cliff, не исправить механизм.
План должен остаться bounded и иметь conservative fallback для shared/native graphs R37-01.

### Acceptance

64→65 на большой selection не превращает O(changed paths + copied spines) traversal в full proxy walk.
Counters считаются вместе с positive full-walk control; outputs и notification count одинаковы.
Большой truly-dense batch может честно выбрать whole reconcile. Не использовать timing-only gate
на shared машине и не утверждать allocation-free flat-array COW: root array copy ещё стоит O(length).

## R37-05 — P2 — primitive reconcile создаёт четыре graph collections

### Наблюдённое поведение

Actual watchers выбирают `tick % 2`, update tick0→2 касается прочитанного leaf, но value остаётся0.
Initial mount/draft warmup исключены. Wrapped constructors сохраняют native WeakMap/WeakSet semantics
и восстановлены в finally. Selector runs и callback0 проверены.

| Watchers | Selector runs | Callbacks | WeakMap constructors | WeakSet constructors |
|---:|---:|---:|---:|---:|
| 1 | 1 | 0 | 3 | 1 |
| 64 | 64 | 0 | 192 | 64 |
| 128 | 128 | 0 | 384 | 128 |

Этим primitive comparison не нужны copy/pair/cycle ledgers. Это constructor volume, не heap bytes.

### Механизм

`reconcileSelection.ts:386-405` создаёт copies (если не передан), два pair WeakMap и open WeakSet
до вызова `reconcile`; primitive return находится уже внутри `reconcile` (`:68`).
Watch дополнительно заранее создаёт nextCopies (`watchSelection.ts:89-95`). Class notification gate
вызвал этот же helper (`Reads.tsx:193-197`); масштабирующая constructor-проба выполнена именно на watch,
а не выдаётся за measured allocation per class instance.

### Решение

Primitive Object.is verdict — до graph context allocation. Consumer ledger создаётся/сменяется
только для object selections; primitive observation не должен требовать свежую WeakMap.
Не short-circuit class/native objects по reference: их текущая policy и topology proof обязательны.

### Acceptance

Equivalent scalar wake —0 graph-collection constructors, callbacks0. Changed scalar delivers.
Primitive→object, object→primitive, undefined/null, NaN/-0, class rejection и native selection transitions
сохраняют контракты. Mechanism counter имеет object/cycle positive control, не blind max0.

## R37-06 — P3 — equal branch migration всё ещё требует class render

### Наблюдённое поведение

Actual hook и class выбирают `useLeft ? left : right`, initial left=right=1.
Chromium controls:

| Transition | Hook total renders | Class total renders | DOM |
|---|---:|---:|---|
| Initial | 1 | 1 | 1/1 |
| useLeft true→false, value unchanged | 1 | 2 | 1/1 |
| Old left1→2 | 1 | 2 | 1/1 |
| Selected right1→3 | 2 | 3 | 3/3 |

Подписки корректно переносятся, old branch молчит и настоящая смена value видима.
Лишний render нужен только текущей реализации migration, не UI output.
Массовый class-list render count здесь **не измерялся**, линейное умножение не выдаётся за benchmark.

### Механизм

`Component/AntiHookComponent/Reads.tsx:179-216`: `selectionUnchanged` возвращает false, если
scratch read set отличается от committed, даже когда reconciled snapshot identity та же.
`wake` делает forceUpdate; перенести read set умеет только subsequent commit.
Hook/watch уже re-file reads на wake без callback/render при equal value.

Это residual branch-migration case нового R36-02 gate, а не прежнее ungated поведение при любой
input write. В исходном раунде gate measured shared selectedId с неизменными paths; этот transition
проверяет именно изменение paths.

### Решение

Reconcile closed scratch observation на notification phase: при equal snapshot обновить connection
subscription/read ownership и baseline без forceUpdate. Сохранять committed props/state, render-in-flight,
StrictMode/Suspense и failed selector behavior. Это внутреннее упрощение existing connectSelection API,
не новая опция и не computed на каждый row.

### Acceptance

Equal branch switch не рендерит owner, old branch остаётся silent, selected branch value change
рендерит и обновляет DOM. New subscription не наследует текущий notification generation; source swap,
committed-props selector и concurrent render сохраняются. Изменять read set в render ради этого нельзя.

## Рекомендуемая последовательность

1. R37-01 — graph eligibility + end-to-end topology, затем differential reconcile tests.
2. R37-02 — complete already-applied patch delivery с сохранением original errors.
3. R37-03 — bounded ownership на subtree shape transitions.
4. R37-05 — primitive allocation fast lane, независимо от patch planner.
5. R37-04 — relative work budget после исправления graph safety.
6. R37-06 — notification-phase read migration без owner render.

API-review conclusion: новый public knob не нужен ни для одной доказанной проблемы. Сохранить
`watch`/`connectSelection`/hook semantics и completed read ownership проще, чем добавлять пользователю
«unsafe fast mode», ещё один comparator или требование вручную разбирать internal path grammar.

## Что не заявляется находкой

- Structural array changes currently fall back; это записанный R36 deviation.
- Flat immutable array snapshot при changed child копирует outer spine: этот remaining O(length)
  не скрыт за словами «всё O(changed paths)», но смена snapshot representation — отдельный API tradeoff.
- Cyclic key working set above capacity и active readonly bulk fallback — уже известны.
- Наличие одного дополнительного class render само по себе не missed update; R37-06 — cost improvement.
- Новые retries/validation/version bumps/telemetry не требуются.

Отчёт фиксирует observed defects/costs, не выполненную реализацию. Все throwaway probes и собственная
browser поверхность удалены/закрыты после получения evidence. Коммит включает только этот файл; push не запрошен.

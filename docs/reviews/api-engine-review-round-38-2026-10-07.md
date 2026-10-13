# API и движок: ревью, раунд 38 — 2026-10-07

## Вердикт

База: `c703dbd93be188824b0ad4142ea5bc080aea494b` (`master`, интеграция R37 и стабилизация общего benchmark suite).
Пять находок: одна P1, три P2, одна P3. Это ревью, не реализация исправлений.

| ID | Приоритет | Область | Подтверждённая проблема / возможность |
|---|---|---|---|
| R38-01 | P1 | Equality / callbacks / renders / O | Неизменный primitive-keyed Map backlink делает cyclic selection «изменившимся»: лишние watch callbacks и hook renders; 16k rows — 144009 recorded reads на запись только внешнего tick |
| R38-02 | P2 | Watch lifetime / retained memory | После object→scalar watch сохраняет старый copy ledger и удерживает уже не выбранную detached копию 10k rows, пока raw rows продолжают жить в store |
| R38-03 | P2 | API ownership / types | Selection outputs — mutable `R`, но это одновременно cache-owned comparison baseline; разрешённая TypeScript запись в fresh projection может убрать следующий callback/render |
| R38-04 | P2 | Allocations | Equal flat object/tuple selections из primitive fields создают 3 WeakMap + 1 WeakSet на каждый wake, хотя graph topology у них отсутствует |
| R38-05 | P3 | Class allocations | Primitive `connectSelection` getter всё ещё создаёт пустой WeakMap на каждый вызов; три parent renders без store writes дали три ledger allocations |

Сначала корректная equality циклов и явное владение cache outputs; затем освобождение неиспользуемого ledger и allocation fast lanes.
Новых публичных performance knobs для доказанных расходов не требуется.

## Метод и границы evidence

- Номер найден по существующим файлам: последний API/engine round — 37.
- `npm run build` выполнен на этой базе: 159 modules в каждой dev/prod ESM/CJS distribution.
- Пробы использовали реальные `dist/cjs-prod` exports; browser consumers — `dist/esm-prod`.
  Это не импорт текущего TypeScript через transpiler и не mock store.
- Runtime: Node `v24.12.0`, React/ReactDOM `19.3.0`, JSDOM `30.0.1`, TypeScript `7.0.2`.
  ReactDOM/JSDOM выводы повторены с `NODE_ENV=production`; Chromium bundle собран с production React.
- Public consumers: `watch`, `useCarburetorValue`, `AntiHookComponent.connectSelection`, `getData`;
  protected `update` вызывался только через обычный subclass bridge:

  ```js
  class Store extends Carburetor {
      change(fn) { this.update(fn); }
  }
  ```

- Constructor counters оборачивали native WeakMap/WeakSet с сохранением семантики и восстановлением globals в `finally`.
  Draft initialization исключена из counted wake. Это **число constructors**, не allocated bytes.
- Cycle/flat-selection counters совпали в трёх независимых процессах.
  Timings — range медиан пяти actual updates в каждом из трёх процессов; машина shared.
  Малые timing ratios и heap-byte/CPU speedups не заявляются.
- Watch retention проверена через `WeakRef`, `--expose-gc` и event-loop boundaries, без искусственного memory pressure.
  Сравнивались object→scalar и object→object; после disposal проверялась collectability при всё ещё живом raw store.
  Это reachability/retention proof, **не измерение heap bytes**.
- Strict typecheck отдельного consumer на freshly generated declarations прошёл: мутации selection outputs допустимы;
  mutation selector input отмечена `@ts-expect-error`, и compiler действительно считает input readonly.
- Source/LSP: `reconcileSelection` имеет 12 references, включая watch, class, hook и primitive patch route.
  Прочитаны их snapshot/cache ownership, copy ledgers и cyclic remap; сравнивались Store/Base types и README.
- Проверенные UI наблюдения подтверждены в managed Chromium; browser error entries пусты.
- Это bounded follow-up по selection API и observation engine. Resources, native Rust rules и весь scheduler не переаудировались.
  Project suite, полный benchmark suite, packed matrix и CI в этом ревью не запускались; предыдущие зелёные runs не выдаются за новые checks.
- Продуктовые source files, постоянные tests, зависимости и версии не менялись. Подагенты не запускались.
  Throwaway probes были только в игнорируемом `worktrees/r38-probes/`; в коммит входит только этот отчёт.

## R38-01 — P1 — unchanged native backlink превращает provisional copy в ложный change

### Repro и поведение

```js
const node = {n: 1};
node.link = new Map([['self', node]]); // primitive key, не object-keyed conservative case
const store = new Store({node, tick: 0});
const seen = [];
const stop = store.watch(d => {
    void d.tick; // dependency меняется, выбранный graph — нет
    return d.node;
}, (next, previous) => seen.push([next.n, previous.n]));
store.change(d => { d.tick = 1; });
store.change(d => { d.tick = 2; });
```

Observed: `seen === [[1,1],[1,1]]`, каждый next — новая ссылка, но `next.link.get('self') === next`.
Graph contents и topology не изменились. Это не stale alias из R37: alias теперь корректен, equality verdict — нет.

| Graph | Callbacks после двух tick writes | Callback при настоящем n1→2 |
|---|---:|---:|
| Plain `{n:1}` | 0 | 1 |
| Plain object self-cycle | 0 | 1 |
| `{n:1, link: Map('self'→node)}` | 2 | 1 |
| Map self-cycle, Map member указывает на сам Map | 0 | 1 |

Реальный hook consumer в production ReactDOM и Chromium:

| Transition | Plain hook total renders | Map-backlink hook total renders | DOM |
|---|---:|---:|---|
| Mount | 1 | 1 | `1` / `1/true` |
| Две tick writes, selected value тот же | 1 | 3 | `1` / `1/true` |
| Настоящая n1→2 | 2 | 4 | `2` / `2/true` |

### Цена и O

Selected rows `{id,n,link}`; только `rows[0].link` — Map backlink на selected array.
Selector читает внешний `tick`, затем возвращает `d.rows`. Пять tick writes, selected rows неизменны.
Счётчик — actual read recorder, не размер массива и не estimate.

| Rows | Plain reads / write | Cyclic reads / write | Plain callbacks / 5 writes | Cyclic callbacks / 5 writes | Cyclic median ms range |
|---:|---:|---:|---:|---:|---:|
| 1000 | 2 | 9009 | 0 | 5 | 31.01–56.74 |
| 4000 | 2 | 36009 | 0 | 5 | 144.48–193.95 |
| 16000 | 2 | 144009 | 0 | 5 | 857.34–1354.06 |

Plain median ranges: 0.0485–0.4547 / 0.0270–0.1603 / 0.0097–0.0301 ms соответственно.
Точный масштаб read work — `9N + 9` для этой cyclic fixture против 2 для tree control.
Не утверждается quadratic O по noisy timings. Ложный dirty verdict также создаёт новую snapshot identity и доставку при unchanged data.

### Механизм

- `lib/src/Carburetor/Store/Utils/Selection/reconcileSelection.ts:72-82` на revisited open ancestor возвращает previous,
  оставляя его provisional copy в ledger для remap.
- `reconcileCollections.ts:28-30` регистрирует новую Map copy до обработки members.
- `reconcileCollections.ts:69-75` видит `fixed !== entry.value` и отмечает changed, если back edge направлен не на сам Map.
  Различие **provisional copy vs old snapshot** принимается за content change даже у unchanged ancestor.
- Аналогичная propagation есть в `reconcileSelection.ts:206-212`; новый Map result делает ancestor новым.
- Watch ref equality (`watchSelection.ts:106-118`) и React snapshot identity наблюдают этот искусственный change.

### Решение

Разделить graph remapping и semantic dirtiness. Завершённый equality verdict для cyclic component должен решать,
использовать старый graph или согласованную новую копию; provisional identity сама по себе не является changed leaf.
Не просто удалить `changed = true` у remap: это вернёт R37-01, когда реальный ancestor edit оставлял native member на old root.

Отдельная безопасная оптимизация existing write-log protocol: для того же live selection root и полного log,
который доказанно не пересекается с root, можно сохранить snapshot даже при shared graph. Unknown/wildcard log требует fallback.
Это направление оптимизации, не выполненный projected fix.

### Acceptance

- В приведённых unchanged fixtures callbacks0 и hook renders1 после tick writes; identity/topology прежние.
- Настоящий n1→2 доставляется один раз; native backlink направлен на новый snapshot, held previous snapshots не мутируют.
- Equal selector-created graphs, initial/introduced cycles, Map value/key и Set-member sharing остаются корректны.
- Disjoint logged write для same live root не требует `9N+9` recorded reads; неизвестный log сохраняет безопасный путь.
- Контроль R37-01 на оба последовательных edits остаётся обязательным.

## R38-02 — P2 — watch scalar branch удерживает detached object branch

### Repro и measured reachability

Initial state: `{active:true, rows:[10000 plain rows]}`. Watch:

```js
store.watch(d => d.active ? d.rows : 0, (next, previous) => {
    if (Array.isArray(previous)) oldSnapshot = new WeakRef(previous);
});
store.change(d => { d.active = false; });
```

Callback не сохраняет strong reference к previous. После переключения идут job boundaries и explicit GC;
raw `store.getData().rows` остаётся живым и имеет length10000. Три процесса дали одинаковые results:

| Transition | Старый detached root жив при active watch | После unsubscribe и drop disposer | Raw rows |
|---|---|---|---:|
| object→scalar `0` | true | false | 10000 |
| object→fresh flat object `{n:0}` control | false | false | 10000 |

Нельзя списать различие на raw state, внешнюю held snapshot или отсутствие GC: control освобождает копию,
а disposal scalar watch тоже делает её collectible при живом raw store.

### Механизм и решение

`watchSelection.ts:65-73` хранит detached copy ledger. Full object pass заменяет его (`:97-102`).
Primitive branch (`:92-95`) меняет selected value, но не сбрасывает `copies`.
WeakMap не гарантирует освобождение value, когда key всё ещё жив: raw selected array продолжает принадлежать store,
поэтому старый ledger держит больше не выбранный detached graph.

На primitive result отказаться от больше не нужного copy ledger и привести eligibility к primitive verdict.
Новая WeakMap для этого не нужна. Hook cache уже публикует `copies:undefined` на primitive pass
(`Interop/useCarburetorValue.ts:264-265,305-306,337`). Не очищать чужие held snapshots и не удалять raw store data.

### Acceptance

- После object→scalar old detached root collectible до unsubscribe, даже если raw object остаётся в store.
- WeakRef/disposal/object→object controls сохраняют различие и не удерживают copies сами.
- Scalar→object обратно получает корректную fresh snapshot и новые children reads.
- Primitive wakes по-прежнему имеют 0 WeakMap/WeakSet constructors; нет «лечения» новым пустым ledger на каждый wake.

## R38-03 — P2 — mutable R скрывает cache-owned selection output

### API footgun, не разрешение изменять raw state

`TSelector<T,R>` читает `TReadonly<T>`, но `watch` callback получает mutable `R`:
`Models/Store.ts:13,116`. Hook возвращает `R` (`Interop/useCarburetorValue.ts:138-142`),
class getter — `() => R` (`Component/AntiHookComponent/Reads.tsx:168-171`).
Fresh projection `{n:d.n}` поэтому mutable, в отличие от selector input.

Strict TypeScript 7.0.2 consumer на generated declarations допускает:

```ts
store.watch(d => ({n: d.n}), next => { next.n = 2; });
const value = useCarburetorValue(store, d => ({n: d.n}));
value.n = 2;
```

Запись `d.n = 2` в selector input тот же compiler отвергает. Class projection output также mutable по типу.
Readonly inferred branch при `d => d.rows` не закрывает fresh object/tuple projections из обычных примеров API.

Это missing ownership contract/type protection: TypeScript legality сама по себе не обещает owned mutable output.
Ревью не объявляет mutation borrowed immutable result хорошим использованием; проблема в том, что public surface
не обозначает этот borrowed-cache boundary достаточно явно и допускает тихое повреждение comparison baseline.

### Actual consumers и controls

Watch state n0, writes n1 и n2; callback изменяет только выбранную projection, не store:

| Callback policy | Values доставлены | Live n после writes |
|---|---|---:|
| Не менять next | `[1,2]` | 2 |
| Изменить собственную `{...next}` copy | `[1,2]` | 2 |
| `next.n = 2` на exposed cache output | `[1]` | 2 |

Hook/class projection capture выполнялся внутри их render. Внешняя запись `selected.n=2`,
затем настоящий store write n0→2: **live n2, cached selection n2, DOM `0`, total renders1**.
Class getter не вызывался вне render в runtime repro. Chromium повторил hook stale DOM, без browser errors.

### Механизм

- `watchSelection.ts:108-118` сохраняет `previous=next` и передаёт **ту же** completed value пользователю.
- Hook `cache.current.value` и returned result совпадают (`useCarburetorValue.ts:330-339,350`).
- Class хранит `snapshot.value` и возвращает его (`Reads.tsx:271-281`).
- Следующее comparison видит уже изменённую пользователем baseline и считает настоящий store write equal.

### Упрощение API

Явно различать две формы владения:

1. Selection result: cache-owned, borrowed, immutable; нельзя изменять как локальную рабочую копию.
2. `store.snapshot()`: user-owned editable plain copy для tooling/restore (существующий mutable `T` contract),
   со своими уже документированными native-reference limits.

Выразить borrowed selection outputs readonly по типам во всех трёх routes и документировать получение отдельной
owned copy, если она действительно нужна. Не добавлять clone-on-every-wake knob и не делать двойной deep copy default.
Native Map/Set/Date нуждаются в честной policy: mapped readonly fields или `Object.freeze(Map)` не запрещают mutator methods.
DEV guard допустим как диагностический механизм; не заявлять safety native values от одного shallow freeze.
Это migration типового ownership boundary, не повод автоматически bump versions в этом ревью.

### Acceptance

- Strict consumers не могут менять fields fresh selection projections и tuple elements без явного unsafe escape.
- README и generated declarations согласованы о borrowed output; editable `store.snapshot()` не превращён в readonly selection.
- У обычных корректных consumers и own-copy control callbacks/DOM сохраняются; invalid mutation не должна выглядеть поддерживаемой.
- JavaScript/native mutation policy обозначена явно; если добавлен runtime guard, mutation диагностируется до cache poisoning.
- Нет дополнительного полного клонирования selection на каждый unchanged wake ради маскировки проблемы.

## R38-04 — P2 — flat primitive containers платят за graph topology

Actual watches на `tick0→2` выбирают `tick%2`, `{n:tick%2,flag:true}` или `[tick%2,true]`.
У всех selected values equal, selector runs ровно один на observer, callbacks0. Три процесса согласились:

| Watchers | Scalar WeakMap / WeakSet | Flat object WeakMap / WeakSet | Flat tuple WeakMap / WeakSet |
|---:|---:|---:|---:|
| 1 | 0 / 0 | 3 / 1 | 3 / 1 |
| 64 | 0 / 0 | 192 / 64 | 192 / 64 |
| 128 | 0 / 0 | 384 / 128 | 384 / 128 |

Selector-created object/array сам по себе — allocation пользователя; таблица считает **engine graph collections**,
не выдаёт их за total allocations. Малые timings здесь не используются: отдельные noisy scalar samples были медленнее objects.

### Механизм и направление

Primitive fast lane в `reconcileSelection.ts:436-438` заканчивается на самом primitive value.
Object path `:442-452` заранее создаёт copies, оба pair maps, open set и sharing closure до проверки,
что все fields/elements — primitives. Watch даёт nextCopies (`watchSelection.ts:97`), остальные ledgers возникают в helper.

Использовать allocation-light flat comparison/detach для доказанно plain data containers без object-valued descendants;
графовые ledgers нужны при появлении настоящего container edge. Existing fast-detach patterns надо переиспользовать,
а не строить второй общий equality engine или публичный «unsafe shallow mode».
Ожидаемое сокращение 3/1→0/0 — recommendation/acceptance, **не измерение реализованного нового fast path**.

### Acceptance

- Equal flat object/tuple wakes: constructors0, callbacks0; настоящая primitive field change доставляется.
- Object child, sharing/cycle и native container control возвращаются на topology-safe full path и видны instrumentation.
- Own `__proto__`, null prototypes, fresh key order, holes vs own undefined, NaN/-0 и descriptor/read tracking semantics не потеряны.
- Primitive→container→primitive transitions не наследуют неправильную eligibility и не требуют нового user comparator.

## R38-05 — P3 — primitive class getter создаёт unused copy ledger

Production ReactDOM owner: `selected=this.connectSelection(store,d=>d.n)`; initial n1.
Три parent prop updates вызывают три owner renders, без store writes. Получено:

- total owner renders4, DOM `1`;
- counted WeakMap constructions3;
- все три constructor stacks ведут в `Owner.selected` → built `AntiHookComponent/Reads.js` → `Owner.render`.

Это per-getter allocation, не лишний owner render: parent render в этой пробе принудителен и не заявляется finding.
Начальную mount allocation в число3 не включали.

`Reads.tsx:179` заранее создаёт initial ledger, а `:268-278` создаёт nextLedger и заменяет его на каждом getter call,
даже для number/boolean/undefined. `reconcileSelection` для primitive завершается до graph context, поэтому ledger пуст и не нужен.
R37-05 убрал graph contexts на notification wake и caller ledgers у hook/watch; этот class render-time путь остался.

Создавать ledger лениво для object-shaped snapshots и освобождать его на primitive transition, сохранив render-attempt reads.
Это внутренняя оптимизация existing getter API; selector не должен перестать запускаться на каждом документированном вызове.

### Acceptance

- Прогретый primitive getter при parent render не создаёт copy WeakMap; result и read ownership те же.
- Initial declaration не создаёт selection ledger до первого object need.
- Primitive/object transitions, source swap, abandoned render, committed props, StrictMode/Suspense не теряют подписки.
- Object/cycle positive control подтверждает, что graph ledgers по-прежнему создаются там, где нужны.
- Не обещать общий allocation-free React render: измерен и устраняется именно unused selection ledger.

## Последовательность и не-находки

1. R38-01: graph equality и settled dirtiness; не откатывать R37 alias safety ради quiet callbacks.
2. R38-03: зафиксировать cache ownership в документации/типах; не менять editable tooling snapshots по аналогии.
3. R38-02: release unused watch ledger на scalar branch.
4. R38-05: локальный lazy class ledger.
5. R38-04: flat primitive container lane после фикса ownership/equality boundaries.

Не переоформляются как новые findings: structural-array full fallback, outer immutable-array spine O(length),
object-keyed native collection conservative equality, cyclic key-cache capacity, active readonly bulk replacement
и остаточные native aliases из старых раундов без отдельного нового repro.

Не предлагаются новые retries, validation flags, telemetry, версии, deprecated aliases или новый selector/comparator API.
Главное API упрощение — честное владение existing selection output; главное уменьшение O/renders — не объявлять unchanged graph dirty.

Отчёт содержит current-base evidence и предложения, не projected implementation и не готовый fix.
Managed browser tab и собственный server закрыты; throwaway source/type/browser probes удалены после фиксации evidence.
Коммит ограничен этим файлом; push не запрошен.

## Исправления и независимая проверка

Все пять находок исправлены в отдельном worktree. Первоначальные 318 строк отчёта сохранены без изменений.

| Находка | Реализация |
|---|---|
| R38-01 | Равные cyclic snapshots сохраняют прежнюю ссылку; disjoint writes проверяются по mutation targets без обхода графа |
| R38-02 | Scalar/flat переход освобождает прежний copy ledger до unsubscribe |
| R38-03 | Watch, hook, class getter и comparator используют borrowed readonly types; tooling snapshot остаётся editable |
| R38-04 | Flat primitive objects/tuples/sparse arrays не создают graph WeakMap/WeakSet |
| R38-05 | Primitive class getter не создаёт copy ledger; selector продолжает выполняться на каждом render |

Raw-target proof хранит максимум две покрытые публикации, с отдельными cardinality/version bounds.
Лимиты — 1024 target entries на сохранённую публикацию и 4096 на pending публикацию; это не byte bounds.
Overflow, неполная атрибуция и слишком старый baseline делают proof недоступным, но не стирают обычную path history.
Missing target текущей публикации не может подменяться target предыдущей публикации того же path.
Opaque draft access пишет branch invalidation: она сохраняется после замены объекта на `null`/primitive,
а planner проверяет invalidation даже под уже выбранным leaf.
Все native aliases регистрируются при capture целого selection, не при обычном `Map.size`/key read.
Дублирующие target-copy maps и remap arrays удалены; двухпубликационный union переиспользуется потребителями.

Readonly — compile-time контракт, без runtime freeze. Map/Set mutators и Date setters исключены;
дополнительные Date fields сохраняют recursive readonly. JavaScript/unsafe casts не получают mutation guard.
Strict watch/hook сохраняют отказ от unsupported live classes; class getter сохраняет прежнюю live-reference policy.

### Замеры

Каждый timing — медиана трёх процессов, в каждом пять посторонних writes. Frozen baseline — код `c703dbd`.

| Cyclic rows | Reads/write до → после | Ложные callbacks на пять writes | ms/write до → после |
|---:|---:|---:|---:|
| 1000 | 9009 → 2 | 5 → 0 | 15.10276 → 0.46326 |
| 4000 | 36009 → 2 | 5 → 0 | 64.69432 → 0.18454 |
| 16000 | 144009 → 2 | 5 → 0 | 314.26980 → 0.04448 |

Timing диагностический: последовательность размеров прогревает JIT, поэтому меньший fixed timing при большем N
не является scaling claim. Регрессионные gates проверяют reads, allocations, renders и values, не эти времена.
Real edits доставляются; backlinks и held previous snapshots сохраняются.

- Flat object/tuple: 0 graph WeakMap/WeakSet вместо 3/1 на watcher; 64/128 watchers также дают нули.
- Primitive class: 0 copy WeakMap на три parent renders вместо 3; object graph — положительный контроль.
- Inactive 10k-row copy collectible до unsubscribe, raw rows остаются живы; object transition — контроль.
- Sparse N4000, K1023/1025/1100: 2047/2051/2201 reads; N16000, K2500: 5001 reads.
- 5000 публикаций: 10 000 reads и 0 equal callbacks; early/late окна по 2000 reads, covered transaction — 2 reads.
- Native size/key consumers: 0 unrelated renders; собственное изменение key и изменение размера отображаются.

### Постоянные бенчмарки и проверки

`perf/gates/selection38.mjs` содержит восемь автоматически включённых записей:
cyclic equality, inactive-copy release, flat primitives, class primitive ledger, два sparse raw-cap размера,
native-read precision и footprint lifecycle. R38-03 — type-only контракт, проверяемый compiler consumers.

- Общий `npm run bench -- --runs 3`: **111 entries, 0 failed, 0 violations** — все 103 старые и 8 новые.
- Полный `npm test`: **194 files, 1855 tests, 0 failures/skips**.
- Build, четыре typechecks, layout, lint и gate lint прошли; lint сохраняет предупреждения существующих правил.
- Packed consumer matrix: **16/16**, React 18/19, npm/pnpm, ESM/CJS, cross-format selection,
  Next 16.3.5 Turbopack/Webpack.
- Реальный Chromium: два equal writes оставляют cyclic/projected renders на 1;
  real edit поднимает их до 2 с DOM `2/true`, class parent render показывает `1/1`; browser errors отсутствуют.
- Независимые runtime/type probes прошли: external/plain/native aliases, raw members, historical owners,
  transaction coverage, omitted current targets, opaque→primitive replacement, budget reset/overflow,
  sparse holes/descriptors, GC retention, normal watch/hook/class consumers и readonly Date fields.

Отрицательные controls проходят без crash и отвергают механизм:
pre-R38 cyclic/lifecycle costs и false callbacks; pre-R37 `ba80fcb70719` sparse reads 28007/112007 и ratio 1;
сохранённый overbroad-read build — лишние native renders; saved missing-target build — пропущенную доставку.
Первый полный прогон обнаружил два native-read precision regressions: исправлен producer, тесты не ослаблялись.
Проверка large-batch контролирует все значения и считает full-walk baseline отдельно от initial selection.

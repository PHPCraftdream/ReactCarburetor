# Фундаментальная природа находок ревью и план рефакторинга

Да, друг. По истории ревью нужен фундаментальный рефакторинг — но не переписывание библиотеки с нуля и не очередное разнесение больших файлов.

**Мой вывод [INFERENCE]: основная причина длинной цепочки находок — распределённые инварианты.** Один смысловой факт хранится в нескольких представлениях, а согласованность между ними обеспечивают отдельные методы, флаги и соглашения о порядке вызовов. Мы исправляли конкретный маршрут; следующий раунд находил другой маршрут к тому же инварианту.

Изучены сохранённые серии: первоначальное JS-ревью, JS R2–R16, performance-аудит, API/engine R6–R29, supplements и integration-отчёты. Они сопоставлены с текущим кодом. Во время исследования код не менялся.

## 1. Что показывают волны

Нумерацию JS и API/engine нужно разделять: это разные серии.

| Серия | Повторяющаяся природа находок |
|---|---|
| Ранние JS R1–R12 | Неполная модель lifecycle и identity: StrictMode, abandoned render, conditional dependencies, stale computed, неправильный receiver, live значения вместо detached snapshots, reentry при отмене запросов. |
| JS R13–R16 | Корректность и стоимость tracking были связаны слишком грубо: wildcard вместо точной зависимости, повторная регистрация, обходы всех читателей/entries, повторное копирование состояния. |
| API/engine R6–R14 | Разные пути записи имели разные семантики: assignment / defineProperty / replacement / restore; patches теряли неявные изменения, snapshots — topology, consumers — скрытые metadata. |
| API/engine R15–R22 | Неявные временные границы: mutation ≠ publication, cached value ≠ announced value, replay ≠ запись subscriber во время replay, одинаковое содержимое ≠ одинаковая identity. |
| API/engine R23–R28 | Взаимодействие history ownership с operational capabilities: descriptors сохранили, но дальнейшая нормализация, load, eviction или invalidation не могли с ними работать. |
| R29 | Совместный ноль на проверенном состоянии. Это хороший результат, но не доказательство, что архитектура теперь исключает эти классы ошибок. |

Важно: не каждая следующая находка была регрессией от предыдущего исправления. Были:

- старые дефекты, открытые другим сочетанием условий;
- реальные регрессии от исправлений;
- уточнения контракта и снятые находки;
- ошибки тестовых consumers и инструментов.

Например, требование уведомлять о metadata-only descriptor change было снято по контракту. А потеря второго history observer после первого ремонта — настоящая интеграционная регрессия. Их нельзя учитывать одинаково.

## 2. Фундаментальные причины

### А. Нет одной явно выраженной модели семантики состояния

Для разных потребителей «сохранить состояние» означает разное:

- `snapshot()` копирует plain containers, но сохраняет opaque значения по ссылке;
- selection должен быть безопасным detached значением;
- history должен самостоятельно владеть native graph и сохранять descriptors/topology;
- operational transition должен иметь возможность изменить lifecycle fields;
- serialization должен включить wire metadata, например settled key.

Это разные задачи, а не пять вариантов одного `deepClone`.

Сначала копирование теряло `__proto__`, prototypes, holes и aliases. Затем — native own descriptors. Потом точное копирование descriptors сделало replay endpoint неподходящим для последующего изменения.

Самая показательная цепочка:

> restore readonly state → history сохраняет restrictions → Pending нормализуется → ресурс должен снова загружаться → native payload не должен блокировать операцию → invalidate тоже должен работать.

Это одна граница, последовательно открытая через разные операции.

Источники: [R23](api-engine-review-round-23-engine-2026-09-30.md), [R25](api-engine-review-round-25-engine-2026-09-30.md), [R26](api-engine-review-round-26-engine-2026-10-01.md), [R27](api-engine-review-round-27-engine-2026-10-01.md), [R28](api-engine-review-round-28-engine-2026-10-01.md).

### Б. Смена состояния — распределённый протокол, а не единая операция

Сейчас разные участки отдельно отвечают за:

1. изменение live state;
2. attribution changed paths;
3. создание patches;
4. инвалидирование identity/topology caches;
5. обновление runtime metadata;
6. запись history;
7. publication;
8. вызов внешних callbacks.

Правильный порядок критичен, но его нужно помнить в каждом маршруте.

Отсюда:

- raw mutation произошла, но observer exception остановил attribution;
- Pending опубликован до регистрации request;
- отменённый request всё ещё доступен для join;
- eviction ledger считает key удалённым раньше фактического удаления;
- bulk operation успела изменить первый entry и упала на втором.

[Находки R22](api-engine-review-round-22-engine-2026-09-30.md) особенно хорошо показывают разницу между «значение изменилось» и «движок корректно оформил совершённое изменение».

### В. Ownership и causality восстанавливаются косвенно

«Кому принадлежит этот факт?» сейчас часто определяется через сочетание:

- object identity;
- status и error message;
- controller identity;
- operation generation;
- текущего значения нескольких flags.

В cache отдельно существуют `requests`, `controllers`, `failures`, `failedRetries`, `invalidatedRequests`. У single-slot ресурса отдельно живут `pendingKey`, `pendingRequest`, `settledKey`, `lastArgs`, raw error и его owner.

Это требует поддерживать согласованность множества полей при каждом load, abort, restore, replacement, failure и reentrant callback.

История raw rejection особенно характерна: сначала поправили `setData`, затем draft replacement, затем same-message replacement, затем ownership при operational graph copy.

Источники: [API R13](api-engine-review-round-13-api-2026-09-30.md), [API R15](api-engine-review-round-15-api-2026-09-30.md), [API R16](api-engine-review-round-16-api-2026-09-30.md).

### Г. Несколько разных понятий были похожи на один «version»

На практике нужны разные факты:

- изменились наблюдаемые значения;
- поменялась topology/identity;
- вычисление устарело;
- вычисление обновило cached result;
- потребитель получил новую publication;
- появилась новая registration под прежним ID.

Их нельзя безопасно выводить друг из друга.

Это проверено на текущем движке реальными короткими consumers:

- equal-content replacement поменял identity при version 0 → 0; последующий native-alias watcher правильно получил `2`;
- operational load принял native accessor payload, getter вызван 0 раз, а strict history capture отказал;
- subscriber write во время undo сохранил `{x:0,y:1}` и отменил redo.

Текущий код эти случаи уже обрабатывает. Проверка показывает, почему их нельзя объединять одним флагом `changed` или `applying`.

### Д. Инварианты завершения и владения были неявными

Примеры:

- read set уже передали индексу, но detachment ещё добавляет в него reads;
- callback выбран по старому ID, но под ID уже новая registration;
- history подавляет все записи, пока `applying=true`, включая новую запись пользователя.

Правильный смысл здесь — не «осторожнее менять Set», а:

> данные передаются следующей фазе только после завершения предыдущей; события относятся к конкретному владельцу и конкретному поколению.

[Watch R21](api-engine-review-round-21-engine-2026-09-30.md) и [history R15](api-engine-review-round-15-engine-2026-09-30.md) — две формы этой проблемы.

## 3. Какой рефакторинг рекомендуется

Цель: единый внутренний протокол переходов состояния, явная ownership policy и явное происхождение изменения.

Не универсальный framework на все случаи. Несколько небольших механизмов, через которые проходят все поддерживаемые операции.

### 3.1. Общая семантика графа, разные именованные политики

Зафиксировать отдельно:

- наблюдаемое store state;
- ordinary snapshot;
- detached selection;
- owned history endpoint;
- operational replacement;
- wire representation.

Общий низкоуровневый механизм должен единообразно понимать prototypes, holes, key order, descriptors, native intrinsics и aliases. Но правила копирования и сравнения должны оставаться различными.

Например:

- metadata-only descriptor change не обязан публиковаться;
- history обязан сохранить restriction при undo/redo value-changing операции;
- operational copy может сохранить native accessor descriptor без вызова;
- history не может обещать ownership результата произвольного getter.

Текущий `cloneOwnedGraph(..., ..., ..., true)` уже объединяет значительную часть обхода. Следующий шаг — сделать назначение политики явным, а не расширять смысл boolean и добавлять новые специальные исключения.

Не заменять все copiers/equalities одной функцией. Это повторило бы причину R27.

### 3.2. Внутренний transition protocol: prepare → commit → delivery

Каждый переход должен проходить через одну границу:

1. Prepare: проверить возможность изменения и подготовить необходимый owned replacement.
2. Commit: установить фактическое состояние, runtime ownership, paths и metadata.
3. Delivery: передать завершённое изменение history/subscribers и выполнить внешние effects.

Нужны явно выраженные:

- origin изменения;
- generation/owner;
- publication mode;
- observable changes;
- topology changes;
- допустимое history representation.

Это позволило бы убрать ручную комбинацию `this.data = …`, сброса `draftProxy`, alias-index invalidation, patch signal и `emitSoon()` из ресурсных методов.

Это не требование откатывать любой `update`. Текущий контракт допускает частично применённые JS writes при исключении. Протокол обязан оформить и опубликовать фактически совершённые изменения, а не объявить вымышленную атомарность.

Reentry также остаётся поддержанным: callback создаёт новый переход с новым generation; продолжение старого перехода проверяет ownership.

### 3.3. Cohesive runtime records для resources

Объединить взаимозависимые runtime facts:

- активный request: generation, controller, shared promise, стартовая invalidation epoch;
- установленный answer: identity, settled key, raw failure presence/value.

Serializable DTO остаётся отдельным представлением.

Тогда settlement принимает ответ конкретного request owner, а не сверяет несколько независимо изменяемых таблиц. Новый answer не может случайно унаследовать failure предыдущего только потому, что совпали key/status/message.

Для single-slot и cache нужен общий протокол и общие правила, не обязательно один огромный generic class.

### 3.4. History должен читать завершённые изменения, а не угадывать контекст

History получает origin конкретной операции и её завершённую границу.

- Replay одной history подавляется только для неё.
- Subscriber mutation во время replay — новая операция, не наследующая replay origin.
- Другой recorder продолжает видеть изменение.
- `clear()` и deferred publication относятся к явно определённым поколениям.

Patch fast path выбирается по проверенному условию:

> представленное изменение действительно обратимо с сохранением обещанной семантики.

Если value patches не сохраняют key order, restrictions или native topology — нужен owned endpoint. Решение принимается на общей границе, а не заново исправляется в producer, history и restore.

Это должно заменить значительную часть coordination flags, а не добавить ещё один flag рядом с ними.

## 4. Почему не рекомендуется «всё immutable» или «только JSON»

Это действительно сократило бы пространство состояний. Но нынешние контракты включают:

- verbatim adoption через `setData`;
- mutable native значения;
- descriptors и native graph history;
- точные подписки;
- subclass actions.

Радикальное ограничение модели потребовало бы осознанного изменения API. Оно не является внутренним рефакторингом «без изменения поведения».

А полный snapshot на каждую операцию уже показал опасность: в R16 generic ownership candidate дал 109.838 ms против 8.523 ms на одинаковых 129 captures, после чего потребовались отдельные исправления стоимости. [Отчёт](api-engine-review-round-16-integration-2026-09-30.md).

Обычные scalar writes должны сохранить patch fast path. Никаких полных graph walks, множества новых объектов или dynamic policy dispatch на каждый read ради красивой архитектуры.

## 5. С чего начинать

Рекомендуемый порядок:

1. Семантическая матрица и законы, до кода: какие свойства сохраняются при каждой операции и в каждом представлении.
2. Первый вертикальный срез — resource/cache transitions. Load, settle, abort, restore, invalidate и removal через общую prepare/commit границу. Это наиболее наглядная концентрация поздних находок.
3. Mutation/publication/history protocol с explicit origin и representation.
4. Observation lifecycle для watch/class/hooks; отделить завершённые read sets от намеренно расширяемых live computed dependencies.
5. Удалить старые обходные пути и дублирующие guards после полного перевода callers. Не оставлять две архитектуры одновременно.

Проверять не только примеры из очередного отчёта, но и короткие детерминированные последовательности операций:

- load → invalidate → late success/error;
- undo → subscriber write → redo;
- equal-content identity replacement → native alias read → write;
- readonly replay → load/abort/invalidate/forget;
- bulk transition → preparation failure;
- CJS producer → ESM consumer.

Критерии — реальные состояния, ownership, notification traces и round trips, а не число внутренних вызовов helpers. Отдельно — bounded benchmarks ordinary scalar path, resource history, alias selection и bulk operations.

## Итог

Нужен рефакторинг не размера классов, а места, где обеспечивается корректность.

Сейчас важный инвариант часто имеет форму:

> каждый метод должен не забыть согласовать ещё несколько полей и вызвать helpers в правильном порядке.

Целевой вариант:

> поддерживаемый переход не может завершиться, не пройдя общую границу согласования состояния, ownership и publication.

Это не исключит любые будущие баги. Но именно такой рефакторинг способен убрать целые семейства повторяющихся находок, а не только следующий конкретный пример.

Начать следует с transition-ядра ресурсов, сохранив текущий публичный контракт и быстрые пути. Уже сделанные общие механизмы — canonical native identity, observer registry, ownership traversal, alias index — сохранять и использовать, а не переписывать вместе со всем движком.

## 6. Семантическая матрица и законы реализации

Этот раздел фиксирует контракт реализации после принятия плана пользователем.

| Представление | Владение и identity | Descriptors и native значения | Назначение |
|---|---|---|---|
| Live store state | `setData` принимает исходный объект verbatim; raw `getData` не tracking API | Принятые restrictions сохраняются; ordinary draft не получает привилегии их обходить | Авторитетные данные для наблюдаемых значений |
| Ordinary snapshot | Plain containers отделены от live state | Plain flags нормализуются; native/class leaves остаются по ссылке согласно существующему контракту | Обычный snapshot/restore |
| Detached selection | Поддерживаемый выбранный graph отделён; aliases сохраняются | Собственные data descriptors и native contents сохраняются; неподдерживаемые class/accessor результаты отклоняются без вызова getter | Безопасный consumer snapshot |
| Owned history endpoint | Полностью owned поддерживаемый graph, не alias живого состояния | Restrictions, key order, holes, prototypes, native contents и backlinks сохраняются; strict unsupported endpoints отклоняются | Точный обратимый endpoint |
| Operational replacement | Одно необходимое owned replacement только при restrictive effective change | Привилегия касается выбранных lifecycle endpoints; opaque payloads и native accessor descriptors не оцениваются и не превращаются в strict history | Подготовка library-controlled перехода |
| Wire representation | Формируется авторитетным producer, а не угадывается из `getData` | Содержит документированную wire metadata, включая settled key; controller/promise/raw error не сериализуются | Persistence, hydration и resource history |

Законы:

1. Value/publication revision и topology/identity change — разные факты: equal-content replacement может требовать инвалидирования ownership cache без новой publication.
2. Read set передаётся индексу после selector, comparison и необходимого detachment. Намеренно расширяемые live computed dependencies используют отдельный lifecycle.
3. Request ownership устанавливается до Pending publication; снимается до abort callbacks. Продолжение после внешнего callback проверяет generation/owner и не перехватывает replacement.
4. Invalidation после начала запроса не может быть поглощена его поздним ответом. Bulk capability preflight завершается до первого live write и изменения request epochs.
5. Raw rejection, включая `undefined` и другие falsy values, принадлежит конкретному answer owner. Новый answer не наследует его только из-за совпадения текста ошибки.
6. Фактически применённые JS writes оформляются до fallible observer delivery. Исключение не превращает изменение в невидимое; частичный native write не объявляется откатанным.
7. History получает закрытую границу операции до ordinary subscriber reentry. Replay подавляется только у своего recorder; callback mutation имеет новый origin.
8. Отложенная publication не возрождает pre-clear history и не создаёт phantom undo после согласования pending writes.
9. Patch representation выбирается только при точной обратимости обещанной history semantics; otherwise используется owned endpoint. Ordinary metadata-only flags не становятся новой notification dependency.
10. Scalar/no-op fast paths не выполняют whole-graph ownership, дополнительную сериализацию, per-leaf allocations или speculative копирование. Новая общая граница не является оправданием для повторного O(state) обхода.

Границы работ:

- Integration owner: основная сессия. Исполнители: только запрошенные `xl`, без nested delegation или подмены.
- Core/publication/history owner: `Store/Carburetor`, mutation/publication registry и history protocol. Он задаёт общий internal installation/replay contract и передаёт его resource owner.
- Resource owner: slot/cache request и answer runtime records, lifecycle operations и operational graph policies; не правит shared core в чужом worktree.
- Observation owner: watch/class/hooks observation lifecycle и завершённые read-set transfers; не меняет расширяемые computed dependency contracts.
- Все исполнители пропускают build/tests/typecheck/lint/format/benchmarks в процессе работы. Основная сессия запускает интегрированные проверки; bounded actual source consumers допустимы для проверки механизма.
- Сохраняются существующие публичные store/resource/React/custom-producer контракты, синхронный reentry, deferred Suspense publication и CJS/ESM shared identities. Старые private обходные пути удаляются после cutover; никаких no-op fallback или compatibility alias вместо миграции.

## 7. Реализованный срез и проверка

Реализация выполнена тремя запрошенными исполнителями `xl` в изолированных worktree на базе
`875ec9a`. Интеграцию, проверку контрактов, исправление выявленных интеграционных ошибок и
финальные gates выполнила основная сессия. Модели не подменялись, nested delegation и Rush не использовались.

### Что изменено конструктивно

- `Carburetor.commitState` и `Store/Transaction/installState` — общий путь установки prepared root:
  validation/diff, topology invalidation, установка live root, согласование metadata, закрытие и delivery.
  `emitStoreUpdate` закрывает применённые writes даже при observer/preEmit exception. Обычный
  replacement использует frozen `STATE_PUBLIC_REPLACEMENT`, mutation/mixed facts также общие.
- `IStateInstallation` различает replacement/public, restore/public или history-owned, и
  operational/owned-operational с обязательным owner. Publication policy и key-only wildcard
  не угадываются из текущих flags.
- `PatchObserverRegistry` передаёт operation facts и сохраняет публичный boolean `ownRestore`
  как проекцию canonical claim. Exact one-shot handoff потребляется в общей installation boundary;
  посторонние операции его не наследуют. Zero-argument custom producer publications поддержаны.
- History подавляет только собственный exact replay owner. Deferred replay согласует baseline
  до последующего fresh delta; mixed batch не откатывает fresh write к pre-replay состоянию.
  Constructor требует только фактически используемые getData/getVersion/restore и IPatchSource:
  реальный custom producer больше не маскируется unsafe intersection cast.
- Slot и cache используют lazy request/answer runtime records. Request identity, shared promise,
  key/args, invalidation epoch, retry fact и raw failure presence относятся к одному владельцу.
  `ResourceCacheState` отделяет installation/restore/invalidation/cancellation/eviction от load/settlement.
  Public slot setData остаётся verbatim и не отменяет активный loader.
- Operational graph ownership задаётся именованной политикой `'operational'`; strict default
  `'history'` не меняет ordinary snapshot/selection контракты.
- Watch, class committed descriptions и hook cache используют completed value/read pairs.
  Completed reads имеют `ReadonlySet` surface; mutable handoff изолирован в передаче индексу.
  Computed сохраняет intentionally extendable path. Completion не копирует Set и не создаёт
  дополнительный value wrapper.
- Удалены старые abortCacheKey/rebindCacheFailures пути и parallel request/controller/failure
  maps/WeakSets. Watch сгруппирован в Tracking/Observation; старого forwarding module нет.

### Ошибки, обнаруженные и исправленные при приёмке

Это реальные интеграционные находки, а не причины сузить контракт:

1. Completed type первоначально наследовал mutable Set API: исправлен на ReadonlySet + brand.
2. Public slot setData первоначально отменял request: восстановлен документированный active-load контракт.
3. Boolean custom restore сохранял alias, но терял redo: handoff теперь несёт exact installation owner;
   regression проверяет оба значения, alias и redo.
4. Deferred undo → fresh write → flush → undo первоначально возвращал pre-replay `1` вместо `0`:
   исправлено baseline/owner согласование, добавлен настоящий sequence regression.
5. Failed pre-loader publication оставляла reload target: rollback возвращает все прежние runtime facts.
6. Cache setData изменял restore generation и терял readonly captured sibling при abort-listener refresh:
   generation теперь меняется только nested explicit restore, live request overlay сохранён.

Source type/import/doc ошибки исправлены после реальных compiler/lint diagnostics.
Неизменные поведения не перепинены к новой реализации. Memo consumer получает сам selected
object, а не только primitive prop, чтобы проверить настоящую snapshot stability.

### Наблюдённая проверка

- Typecheck и layout прошли: семь entries, 600 code lines, один export/file.
- Lint прошёл: ноль ошибок, 46 warnings; локальный scratch exclusion не коммитится.
- Observation focused suite: 40/40 в трёх файлах.
- Resource/history/observer focused suite: 447/447 в 43 файлах, без skips/todos/snapshot changes.
- Полный suite: 1505/1505 в 140 файлах, без skips/todos/snapshot changes; 484248 ms reported total.
- Built dev/prod CJS↔ESM transition consumers: 164/164. До изменения те же 164 cases прошли на frozen baseline.
- Packed consumers: 16/16, React18/19 npm/pnpm CJS/ESM, mixed formats,
  Next16.3.5 webpack/Turbopack; без skips/failures.
- Actual Chromium React class + hook: equal branch switch даёт parent renders 1→2,
  memo/hook остаются 1; old leaf write никого не перерисовывает; selected leaf даёт
  parent3/memo2/hook2 и DOM `7/7`. Readonly invalidation не запускает loader, refresh даёт `a!`
  при одном loader call, held flag/readonly и root/entry backlinks сохраняются.
  Undo subscriber branch даёт `{x:0,y:1}` без redo; её undo даёт `{x:0,y:0}`.
  Browser error entries пусты. Собственная browser поверхность остановлена после proof.

### Paired реальные workloads

Frozen pre-refactoring distribution `875ec9a` против финальной production distribution;
семь samples, реальные операции и сохранённые counters. Это не allocated-byte measurement.

| Workload | Baseline median ms | Refactored median ms | Сохранённая работа |
|---|---:|---:|---|
| Ordinary patch history | 0.488 | 0.479 | 128 writes, один capture |
| Resource snapshot history | 22.495 | 32.946 | 64 loads, 128 transitions, 129 captures |
| Populated cache replacement | 0.049 | 0.053 | extra endpoint visits0/0 |
| Mixed graph capture | 0.124 | 0.174 | root/row visits1/1 |
| Native alias selection | 0.4065 | 0.3597 | 128 lookups, checksum8128, paths129, root2/row256 |
| Completed watch branch transitions | 3.3440 | 3.1072 | 128 rows, notifications128, checksum8256, publications3 |
| Writable single invalidation | 0.5402 | 0.4291 | 128 entries/publications, loaders0 |
| Writable bulk invalidation | 0.3899 | 0.4940 | 128 entries, одна publication, loaders0 |

Resource timing первого набора имеет широкий диапазон: baseline14.517–54.111 ms,
refactored14.639–131.221 ms. Повтор того же paired driver дал 40.273→41.670 ms
(ranges 33.921–64.496 и 39.634–54.380); ordinary 1.028→0.880 ms,
cache 0.104→0.144 ms, mixed 0.356→0.314 ms. Оба набора сохранены, никакого speedup
или доказанной throughput parity не заявляется. Counts не выросли; timings зависят от среды.
Refactor не добавил whole-graph work к ordinary scalar path, но реальные application profiles
остаются обязательными перед будущими performance выводами.

Плановый срез реализован целиком, а не scaffold. Это не обещание отсутствия любых будущих
дефектов и не новый независимый zero-review verdict. Push в этой реализации не запрашивался.

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

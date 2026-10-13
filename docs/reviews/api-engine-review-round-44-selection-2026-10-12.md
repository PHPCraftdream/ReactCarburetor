# Раунд 44 — Selection, paths, publication и history

Дата: **2026-10-12**. Reviewed base: **`acfd3e2b8e58210ce1076bf1683f666283216af5`**. Исполнитель: **xxs / R44Selection**. Scope: `lib/src/Carburetor/Store/Utils/Selection/**`, `Tracking/**`, `Paths/**`, `Scheduling/**`, `Tooling/CarburetorHistory.ts`, `Tooling/Graph/**`; относящиеся selection/history/state/subscribe/write-log/native-alias benchmark families.

**Review-only.** Изменён только этот Markdown. Production, tests, benchmark/config/dependency/version files, git и `.claude/scheduled_tasks.lock` не изменялись; build, suites, lint, formatters, commit/push отсутствуют. Все непроверенные прогнозы, сложности и направления улучшения обозначены **[INFERENCE]**. `xd://lsp` отсутствует среди доступных devices; definitions/references прослежены чтением и grep, LSP hover/type/reference results не заявляются.

До анализа прочитаны [R43 selection report](api-engine-review-round-43-selection-2026-10-11.md), включая границы/отклонённые candidates, и [R43 overview Resolution](api-engine-review-round-43-2026-10-11.md#resolution-реализация-r43). Его **10 fixes уже входят в base**. R41/R42 fixes и repaired React18 console fixtures не выдаются за новые findings.

## Итог и ранжирование

| ID | Приоритет / тип | Подтверждённый механизм | Исполненное evidence |
|---|---|---|---|
| **R44-S01** | **P1, correctness / selection delivery** | Spine copier вызывает `before.slice()` у поддержанного массива с prototype `null` / `Object.prototype`; метода нет, graph watch пропускает реальное изменение | Во всех четырёх formats: raw=1, graph deliveries=0 в четырёх cases, scalar и fresh-projection controls=1; development сообщает `value.slice is not a function` |
| **R44-S02** | **P2, work / temporary ownership** | History продолжает владеть object patch endpoints после необратимого для batch `pendingOpaque=true`, хотя entry уже будет snapshot | После native-first marker: **6 / 34 / 170** `Reflect.ownKeys` visits внутри `super.onPatch`; эти endpoints в publication не используются. Native-last и plain controls различают момент возникновения opacity |
| **R44-S03** | **P3, allocation machinery / replay** | Primitive final-path verdict в `sameHistoryGraph` создаёт два graph WeakMap до `Object.is`, хотя графа нет | При P=1/8/32/64: **2/16/64/128 WeakMap constructors** в каждом undo и redo publication window; ordinary recording=0, graph positive=2 |

S01 важнее оптимизаций: «нет callback» здесь означает stale graph selection, а не успешный render bailout. S02/S03 не являются измерением bytes, CPU instructions, GC, wall-clock или React renders. Нового public API, compatibility shim либо consumer cleanup knob не требуется.

## Provenance и границы наблюдения

Parent предоставил frozen distribution **`worktrees/bench-dist/acfd3e2b8e58/{esm,esm-prod,cjs,cjs-prod}`**. Прочитан receipt `.rush/stdin/r44-base-build.json`: head совпадает с reviewed base; supplied provenance — primary build после final R43 Set cleanup, acfd3e2 меняет fixture/test diagnostics, не `lib/src`. Это **не мой rebuild и не independent hash verification**.

Мною исполнены три bounded real-public-API probes в каждом format, **12 последовательных Node v24.12.0 processes**. Перед matrix также были три exploratory esm-prod executions тех же сценариев; итого **15 процессов**. Ни один не запускал suite/runner, artificial CPU/heap pressure, GC, UAC, tracing, parallel runtime, browser или React. Каждый child имел 20-second deadline; максимальные fixture axes — P=64, N=32, K=3, sparse length=16. Все exits=0, stderr пуст; development diagnostic S01 перехвачен в `console.error` и сохранён как data. Exit 0 у S01 означает «controls прошли и discrepancy напечатана», **не** passing desired invariant.

Для всех matrix processes команды были буквально `node --input-type=module -e <source блока ниже>`, cwd — repository root; `DIST_ROOT` задавался соответствующим frozen format, `NODE_ENV=production` для `*-prod`, `development` для остальных. Source не записывался в отдельные файлы. Инструментация прозрачная и возвращает intrinsic result; восстановление — `finally`. Она считает операции в явно указанном окне, не total operation cost. Opaque exploratory source отличался только бессодержательным `assert.equal(Reflect.ownKeys, Reflect.ownKeys)` вместо final restoration check и отсутствием `savedOwnKeys`; его self-comparison не считается evidence. В final четырёх executions действует проверка original identity, приведённая ниже.

## R44-S01 — поддержанные array prototypes ломаются в успешном patch plan

### Достижимый consumer и anchors

Обычный subclass публичного `Carburetor` реализует action через protected `update`. Caller создаёт rows как настоящий `Array` и до передачи в store делает `Object.setPrototypeOf(rows, null)` либо `Object.prototype` — например, чтобы убрать inherited array methods. Consumer делает `store.watch(d => d.rows, onChange)`. Rows содержат ordinary object members; это graph selection, а не primitive-flat lane. Action `d.rows[0].n = 1` меняет только scalar leaf.

Поддержка этих prototypes — не предположение о расширении API:

- [Tracking/isTrackable.ts:7–9](../../lib/src/Carburetor/Store/Tracking/isTrackable.ts#L7) принимает `Array.prototype`, `Object.prototype`, `null`.
- [detachCore.ts:126–149](../../lib/src/Carburetor/Store/Utils/Selection/detachCore.ts#L126) создаёт detached array и сохраняет каждый из этих prototypes; [reconcileSelection.ts:121–131,300–305](../../lib/src/Carburetor/Store/Utils/Selection/reconcileSelection.ts#L121) делает то же на full path.
- Existing source coverage [diff.test.ts:505–580](../../__tests__/Engine/Store/Carburetor/diff.test.ts#L505), [R39/array-prototype.test.ts:3–16](../../__tests__/Engine/Store/Carburetor/Selections/restore/R39/array-prototype.test.ts#L3) и [README:306–315](../../README.md#L306) явно сохраняют supported object/array prototype transitions. Эти suites **не запускались**.

New gap:

1. [watchSelection.ts:91–95](../../lib/src/Carburetor/Store/Tracking/Observation/watchSelection.ts#L91) выбирает write-log route, когда live selection та же и существует copy ledger.
2. [patchFromWriteLog.ts:55–61,87–89](../../lib/src/Carburetor/Store/Utils/Selection/Patch/patchFromWriteLog.ts#L55) допускает небольшой inside-root leaf plan.
3. [patchSelection.ts:10–19](../../lib/src/Carburetor/Store/Utils/Selection/Patch/patchSelection.ts#L10), symbol **`cloneSpine`**: `isPlainSpine` признаёт обе формы допустимыми, но array branch использует **`value.slice()`**. У сохранённого prototype `null` / `Object.prototype` этого метода нет.
4. [patchSelection.ts:62–65,79–81](../../lib/src/Carburetor/Store/Utils/Selection/Patch/patchSelection.ts#L62) копирует изменённый spine и ловит только собственный `PatchFallback`. `TypeError` не вызывает safe full fallback. Обычная subscriber isolation оставляет write применённым, но watch callback не получает graph ([reportDeliveryFailure.ts:9–15](../../lib/src/Carburetor/Store/Diagnostics/reportDeliveryFailure.ts#L9)).

Это **не R43-S01**: finite `0→1`, не signed zero/NaN, content gates уже `Object.is`. И не старый R13/R14/R39 prototype replacement finding: initial detach и independent full-projection lane корректны; ломается отдельный **partial spine-copy**.

### Наблюдение и controls

Probe S01: по шесть cases на format — три prototypes × dense/sparse. Sparse length=16, own indices 0 и 9. До finite edit настоящий no-op `n=0` даёт 0 graph/projected/scalar callbacks и 0 diagnostics.

| Prototype | Shapes | Raw после edit | Graph watch deliveries | Fresh outer projection | Scalar watch | Unrelated `spare` |
|---|---|---:|---:|---:|---:|---:|
| `Array.prototype` | dense, sparse | 1 | 1 | 1 | 1 | 0 |
| `null` | dense, sparse | 1 | **0** | 1 | 1 | 0 |
| `Object.prototype` | dense, sparse | 1 | **0** | 1 | 1 | 0 |

Таблица одинаковая во всех formats. В двух standard-array positive controls delivery содержит n=1/old=0, правильные length/prototype/holes, held old value и identity untouched row. У failing cases нет delivered graph, поэтому сохранность его *нового* prototype/holes не заявляется. Development esm/cjs для каждого failing case печатают один exact diagnostic:

~~~text
Carburetor: a subscriber threw while a write was delivered: value.slice is not a function. The write had already landed, so the remaining subscribers were notified anyway.
~~~

Production diagnostic отсутствует по существующей policy, но missing delivery сохраняется. Ошибка не возникает в consumer callback — он не вызывается. Не было изменения prototype после создания store, raw state mutation, Array subclass, custom `slice`, inherited numeric pollution или broad invalidation.

### Механизм работы, направление и риски

**[INFERENCE]** Для tree-only scalar patch: D — глубина changed path; C — суммарные shallow widths копируемого spine; L — logical array length, M — own occupied indices. Необходима O(D) navigation и shallow copy spine, но текущий unsupported method call прекращает операцию вместо корректного verdict. Здесь не измерены slice work/bytes/CPU и не доказан native O(L) hole walk; длина sparse array сама по себе не счётчик работы.

**[INFERENCE]** Консервативное направление — один корректный shallow array-spine copier, который не зависит от receiver-provided methods, сохраняет supported prototype, length, own indices/holes и unchanged references. Использовать существующие dense-prefix/own-key patterns, а не deep-detach untouched members. Просто `Array.prototype.slice.call(before)` устраняет missing method, но само по себе не доказывает сохранение `null`/`Object.prototype` у copy. Не отключать patching для всех таких arrays и не глушить `TypeError`; underlying supported copy должен быть корректным.

Сохранить SameValue content verdict, hole vs own-undefined, `__proto__` handling для object spine, array subclass rejection, graph sharing/cycle fallback, successful-only ledger registration и bounded read-set ownership. Shared helper consumers source-traced: `watchSelection`, class `reuseSelection`/`Reads.tsx`, `Interop/useCarburetorValue.ts:295–299`, `Interop/createResourceReader.ts:143–145`. **[INFERENCE]** Их eligible same-live graph routes рискуют той же exception; mounted hook/class/resource-reader DOM и render counts здесь не исполнялись и не заявляются.

### Предлагаемый benchmark acceptance

**[INFERENCE]** `selection44/array-spine-prototype`: `Array.prototype/null/Object.prototype` × dense/sparse × root/nested selected array, stable-live graph и fresh projection controls. Finite and signed-zero actual edit — ровно одна правильная delivery; canceled NaN и own-value no-op — 0; held snapshot не переписывается, untouched row shared, prototype/length/holes сохранены, own-undefined addition/deletion различаются. No subscriber exception; real class/hook committed DOM позже проверяет parent.

Для perf axis M фиксировать отдельно от L, считать фактические own-slot/shallow-copy операции, а не выдавать L за visits; плотный массив — positive floor. Shared/cyclic selector graph, object-valued leaf/structural markers, unsupported subclass и unknown/wildcard write log — full-path controls. Сохранить `selection31`, `selection37/alias-topology`, `selection38/sparse-raw-cap`, `selection42`, `selection43/same-value` и `writelog39` acceptance, не ослаблять gates ради нового copier.

## R44-S02 — history владеет endpoints после того, как patch entry уже невозможен

### Достижимая операция и source evidence

Исходное plain tree: `{stamp: null, slot: null, keep: {n: 7}}`; один attached `CarburetorHistory`. Один обычный `update` сначала устанавливает `stamp = new Date(1000)`, затем новый plain rows graph в slot. В более насыщенном control тот же slot K раз заменяется через `null`, сохраняя только последний graph. Ни native mutation через raw reference, ни unsupported endpoint для этого не нужны.

- [CarburetorHistory.ts:266–286](../../lib/src/Carburetor/Tooling/CarburetorHistory.ts#L266), **`onPatch`**, учитывает replay ownership/structural markers, но **не отсекает описываемые patches при уже true `pendingOpaque`**.
- [Там же:295–320](../../lib/src/Carburetor/Tooling/CarburetorHistory.ts#L295): `own(previous)` и `own(next)` копируют object endpoints; Date trait ставит opacity. Следующие ordinary endpoints всё равно копируются, fold-ятся или добавляются в `pendingPatches`.
- [Там же:458–464,499–522](../../lib/src/Carburetor/Tooling/CarburetorHistory.ts#L458): `buildEntry` при opacity сразу выбирает **`buildSnapshotEntry`**. Он читает baseline/current capture, а не pending endpoints. [record:370–374](../../lib/src/Carburetor/Tooling/CarburetorHistory.ts#L370) затем освобождает patches.
- [cloneOwnedGraph.ts:23–29,65–101](../../lib/src/Carburetor/Store/Utils/Graph/cloneOwnedGraph.ts#L23): даже уже writer-owned plain endpoint действительно traversed и copied history-владельцем.

Первое превращение в opaque требует classification/ownership и не считается лишним: заранее нельзя знать последующий native trait. Однако после него snapshot route для данного batch уже неизбежен. Это **не R17-ENGINE-04** (повторный discarded traversal внутри одного capture), не R16 duplicate snapshot endpoint copy и не repaired **R43-S02** (impossible scalar fold search). Здесь лишние endpoints создаются **между уже принятым opaque verdict и закрытием publication**, и не используются ни для before, ни для after snapshot.

### Измеренный work и положительные controls

Probe S02 считает `Reflect.ownKeys` только внутри реального `super.onPatch(patch)`; writer cloning, construction capture, final snapshot capture и replay находятся вне окна. `opaqueBefore` снят до вызова super. Метрика — actual reflection visits, не bytes/total copies/time. K insertions чередуются с K−1 removals; graph содержит N row objects, один rows array и root slot object.

Следующие числа одинаковы в esm/esm-prod/cjs/cjs-prod:

| N | K | Mode | Patch events | All onPatch own-key visits | Visits **после opacity** | Pending records при publication | Kind |
|---:|---:|---|---:|---:|---:|---:|---|
| 4 | 1 | no-op | 0 | 0 | 0 | 0 | none |
| 4 | 1 | plain-only | 1 | 6 | 0 | 1 | patches |
| 4 | 1 | native-first | 2 | 7 | **6** | 1 | snapshot |
| 4 | 1 | native-last | 2 | 7 | 0 | 1 | snapshot |
| 32 | 1 | no-op | 0 | 0 | 0 | 0 | none |
| 32 | 1 | plain-only | 1 | 34 | 0 | 1 | patches |
| 32 | 1 | native-first | 2 | 35 | **34** | 1 | snapshot |
| 32 | 1 | native-last | 2 | 35 | 0 | 1 | snapshot |
| 32 | 3 | no-op | 0 | 0 | 0 | 0 | none |
| 32 | 3 | plain-only | 5 | 170 | 0 | 3 | patches |
| 32 | 3 | native-first | 6 | 171 | **170** | 3 | snapshot |
| 32 | 3 | native-last | 6 | 171 | 0 | 3 | snapshot |

Non-no-op public endpoints правильны после update, undo и redo: slot first row n=K → null → K, Date time=1000 → null → 1000 там, где Date был установлен; watch deliveries=3, unrelated keep deliveries=0. No-op — 0 deliveries и нет undo. Plain-only — positive counter/patch-route control. Native-last не позволяет объявить *все* object copies ненужными: до terminal native patch history ещё должна владеть обычными endpoints. Native-first показывает тот же final operation и snapshot kind, но copy work идёт **после** принятия opacity. Intrinsic `Reflect.ownKeys` identity восстанавливается и проверяется в final source.

### Точные dimensions, направление и риски

**[INFERENCE]** A — число последующих patches после opacity; S — сумма nodes+own fields object-valued previous/next endpoints этих A patches; T — размер текущего графа final capture, D — path depth. Добавочный ненужный owned traversal/copy член — O(S), плюс pending recording/fold work. Это не утверждение O(T)→O(1) для whole operation: authoritative snapshot capture остаётся O(T), а [writer reportPatch:179–182](../../lib/src/Carburetor/Store/Tracking/createWriteProxy.ts#L179) всё ещё делает `clonePatchValue` по своему независимому protocol. В fixture exact measured after-opacity visits равны **(2K−1)(N+2)**: 6, 34, 170. Extrapolation к другим graphs/размерам — [INFERENCE].

**[INFERENCE]** Pending owned copies также имеют strong ownership до `record`/`clear`, даже если исходные transient graphs уже не находятся в store. При manual throttle эта lifetime длиннее call frame; размер graph/число живых objects или heap bytes **не измерялись**. Это temporary ownership opportunity, не доказанная GC leak.

**[INFERENCE]** Направление: после record-local irreversible opaque verdict не строить/не fold-ить обычные owned endpoints; уже накопленные ненужные copies можно освободить на той же границе. Делать это **только в конкретном history**, не выключать patch producer или независимые observers. Replay `attempt.started`/owner suppression должны обрабатываться раньше fast exit; последующие `PATCH_ARRAY_LENGTH_LOCK`/`PATCH_KEY_ORDER_CHANGE` обязаны всё ещё установить `pendingOwnedReplay`. Нельзя потерять exact replay adoption, readonly/locked descriptors, key order, native/plain alias topology, per-history baseline и capture refusals. Reset должен оставаться на всех `record`/`clear`/own-replay boundaries.

Source references к pending state вне `CarburetorHistory` — benchmark/testing instrumentation; typed replay host не использует pending endpoint list как capture input. Protected `onPatch`/`record`/`buildEntry` override seams не удаляются. Не предлагается public cutover или новый «opaque batch» API.

### Предлагаемый benchmark acceptance

**[INFERENCE]** `history44/after-opaque-endpoints`, отдельные axes A/S/T: N=4/32/256, K=1/3/8, unrelated padding отдельно; native-first/native-last/plain/no-op. После fix after-opacity owned visits=0, endpoints/publication counts прежние, plain ownership positive >0, snapshot captures не подавлены. Сохранить реальный snapshot replay и отсутствие unmatched wakes.

Parent отдельно расширяет на array-length lock/key-order marker *после* opacity, native graph sharing/cycles/backlinks, restricted endpoints, exact own-replay refusal, independent histories, clear-before-flush и reentrant writes, one-update/transaction/manual-throttle. Unsupported accessor должен по-прежнему отказываться в authoritative capture без вызова getter. Времена — отдельный **неинструментированный completed-operation** lane; constructor/reflection counts нельзя преобразовывать в saved bytes/instructions. Existing `history/mixed-capture`, `state/resource-history`, `history39` и `history43` guards сохраняются.

## R44-S03 — primitive history final verdict заранее создаёт graph ledgers

### Reachability и anchors

Обычный store `{box: {n: 0}, spare: {n: 7}}`, attached history, scalar update, затем public `undo()` / `redo()`. Это warmed base-store patch replay; custom restore/snapshot/native restrictions не требуются.

- [replayPatchesOnDraft.ts:62–71](../../lib/src/Carburetor/Tooling/Graph/replayPatchesOnDraft.ts#L62) stage-ит owned baseline, а publication сверяет final installed paths.
- **`matchesInstalledPaths`**, [там же:91–110](../../lib/src/Carburetor/Tooling/Graph/replayPatchesOnDraft.ts#L91): после own-descriptor navigation scalar leaf передаётся `sameHistoryGraph(before, after)`.
- [sameHistoryGraph.ts:11–16](../../lib/src/Carburetor/Tooling/Graph/sameHistoryGraph.ts#L11) безусловно создаёт `forward` и `backward` **до** primitive/null/function identity branch `Object.is`. Ни один ledger в этом branch не используется.
- Callers также находятся в [CarburetorHistory.ts:446,448,509,199,232](../../lib/src/Carburetor/Tooling/CarburetorHistory.ts#L446); только scalar replay caller фактически инструментирован.

Это не repaired R43-S02: recording fold hint действительно сохранён, обычный scalar record не создаёт counted WeakMaps. Здесь цена возникает при **post-install replay reconciliation**. Не R37 primitive selection ledgers: другой helper и другой жизненный цикл.

### Измеренный work и controls

Probe S03 wraps constructors/descriptors только на время реального `super.record(fact)`, а не вокруг всего undo. Store/history construction, mutation trap work и baseline staging снаружи. WeakMap wrapper — subclass intrinsic, сохранена настоящая Map semantics. P — recorded patches последнего replayed entry; D=2 (`box.n` / `box.ni`).

| P входных writes | Mode | P в replayed entry | Record WeakMaps при ordinary writes | WeakMaps **на каждый undo / redo** | Descriptor calls на каждый undo / redo | Ordinary deliveries total |
|---:|---|---:|---:|---:|---:|---:|
| 1 | repeat/distinct | 1 | 0 | **2** | 4 | 3 |
| 8 | repeat/distinct | 8 | 0 | **16** | 32 | 3 |
| 32 | repeat/distinct | 32 | 0 | **64** | 128 | 3 |
| 64 | repeat/distinct | 64 | 0 | **128** | 256 | 3 |
| 1/8/32/64 | separate | 1 | 0 | **2** | 4 | P+2 |

Repeat меняет один существующий scalar P раз в одном update; distinct — P разных существующих scalar keys в одном update. Separate — P независимых publications, undo/redo только последнего entry. Значения, undo/redo endpoints и exact ordinary deliveries проверены; spare deliveries=0 во всех cases. После genuine no-op нет record boundary. **Graph positive**: redo `slot={n:1, child:{n:2}}` даёт `{origin:'restore', weakmaps:2, descriptors:8}` и правильное nested value. Таблица совпадает во всех четырёх formats.

Обёртка видит constructors именно в record window; это не promise «в whole undo существует только 2P allocated objects». Descriptor count — отдельная operation metric, не heap bytes и не предложенная здесь экономия navigation.

### Complexity, направление и риск

**[INFERENCE]** Для P primitive leaf proofs current allocation-machinery член — **2P empty WeakMaps**, time O(P) по этим constructors; own-path validation остаётся O(PD). Graph endpoint comparison по-прежнему требует O(V+E) topology/descriptor traversal и bidirectional mapping. Lifetime этих empty ledgers — один helper invocation, это **не retention finding**.

**[INFERENCE]** Консервативное направление — primitive/null/function verdict *до* создания graph context, совпадающий с уже существующим внутренним `equal` branch. Object-shaped pairs остаются на нынешнем graph path. Нельзя добавлять blanket `left === right` object fast path, который обходил бы opaque class rejection или graph capability/topology policy; нельзя заменить `Object.is` на `===` (signed zero/NaN), менять Map/Set key/member semantics или убирать final installed-path check.

Сохранить **все P исходных patch replay operations** и publication semantics: scalar compaction, snapshot replacement, более широкий dedup/caching или новый API в этот finding не входят. Repeated final paths могут быть отдельным будущим proof-dedup design, но здесь нет доказательства безопасного изменения mutation-time observer trace. У P=1 control уже видны обе ненужные graph tables; оптимизация не зависит от отсутствия repeats.

### Предлагаемый benchmark acceptance

**[INFERENCE]** `history44/scalar-final-proof`: P=1/8/32/64/256; repeat/distinct/separate, ordinary/native-safe baseline, path depth отдельно, unrelated graph size отдельно. Primitive record reconciliation WeakMaps=0 после fix; graph positive продолжает создавать topology machinery, но gate должен быть mechanism-oriented, а не pin любой конкретной implementation identity. Descriptors/path checks, endpoints, histories/cursor/reentrant refusal и exact deliveries сохраняются; no-op=0. SameValue numeric replay matrix из `selection43` остаётся обязательной. Отдельный uninstrumented latency lane проверяет completed update/undo/redo, без tiny noise-sensitive ceiling. Existing `history39/native-scalar-*`, `history/undo-one-field`, `history43/scalar-batch` нельзя ослаблять.

## Проверенные границы и отклонённые / повторные candidates

- **R43-C01/C02/C03/S01/S02/S03/R01/R02/A01/A02** не повторяются. Content gates уже `Object.is`; alias answers root-first weak и без strong root. Comparator/resource/React fixes находятся вне новых IDs этого topic. Их previous measured gains не переатрибутируются этому review.
- **R41/R42 не открываются заново.** R42 outside dictionary route не считает shallow size; multi-write shared ancestor Set dedup уже есть. R41 naming/last-observer/dependency-membership/resource memo-child fixes не являются candidates здесь.
- **Native alias precision:** `NativeAliasReads` хранит generation-scoped answers; raw native own data обходится без getter invocation, root backlink остаётся wildcard. `NativeAliasIndex.noteChange` ремонтирует только proven uniquely-owned disjoint branches, иначе индекс ленивый. Reflection arrays и generation invalidation остаются source-visible floors, но ни нового GC finding, ни нового measured alias-index scaling здесь нет.
- **Projection graphs:** SameValue values, SameValueZero Map/Set keys/members, raw↔copy bijection, cycles/sharing, sparse holes, raw-target exposure и unknown/overflow fallback не объявлены ненужной работой. Snapshot native references — documented caller-owned boundary; history owned native baseline — отдельная необходимая ownership. S01 касается допустимого shallow array copier, не отмены этих proofs.
- **Inside-root shallowSize** ещё eager; это уже отмеченный R43 residual рядом с R42 enumeration и `selection42` selected enumeration positive floor. Новый ID не выдан. **Sparse native slice complexity** не измерена: logical length не доказывает V8's actual visits/bytes; generic/proxy receiver probe изменил бы consumer case. Новый performance claim только из L не сделан.
- **Mixed history folding:** publication-local possible-owned-target hint всё ещё консервативно true после owned target; `foldDependentPatch` может сканировать смешанный pending list. Это явно оставленная R43 boundary, не новый R44 scalar-only quadratic finding; такие probes здесь не исполнялись. `past.shift()` O(limit) — уже известный R36 limit, default 50.
- **Subscriber filing:** public caller read Sets копируются намеренно, transferred completed sets и `addPath` имеют другой ownership contract. `SubscriberIndex.add` diff и descendant contribution counts необходимы, чтобы удаление одного read не сняло остальные. Unchanged completed watch reads пропускают refile; scheduled replacement всё ещё должно отменять старый updater и менять generation. Не предлагается unsafe «same Set значит same subscription» public shim.
- **Publication/write-log:** свежий write Set передаётся по ownership, no-op touched draft не публикует, write-target proof остаётся отдельно count-bounded/lazy; wildcard, watermark, missed/incomplete raw attribution — conservative boundaries. PathsSince latest-write index не сканирует весь старый log. Нет нового доказанного render или asymptotic regression в matching/index publication.
- **Scheduling:** прочитаны wave snapshot/drain и throttle active/enclosing cancellation, reusable maps, exception isolation/depth budget. Empty/single paths не требуют нового scheduler API. `UpdateWave` entry tuples — source-visible small allocation candidate, но отдельного ID без bounded attribution и consumer benefit не выдано.

## Exact bounded probe sources и фактический вывод

Каждый блок самостоятельный ESM source, принимает конкретный format directory в `DIST_ROOT`; ESM `index.mjs` / CJS `index.js` выбираются как в existing history43 fixture. Parent может скопировать блок в PowerShell here-string `$s01`/`$s02`/`$s03` и запустить **последовательно**, без создания probe files:

~~~powershell
$env:DIST_ROOT = 'D:/dev/ReactCarburetor/worktrees/bench-dist/acfd3e2b8e58/esm-prod'
$env:NODE_ENV = 'production'
node --input-type=module -e $s01
node --input-type=module -e $s02
node --input-type=module -e $s03
~~~

Те же три команды использовались через Node argv со source из соответствующего блока. Для `esm`/`cjs` установить `NODE_ENV=development`; затем менять только suffix `DIST_ROOT`. Ниже приведён **exact JSON stdout esm-prod final executions**; другие formats имеют те же numerical/functional results, отличаются root и development diagnostics S01, показанным выше. Это observational probes: они не pin desired future counters и не заменяют parent verification.

### S01 source — supported array spine prototypes

~~~js
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root = resolve(process.env.DIST_ROOT);
const esm = resolve(root, 'Carburetor/index.mjs');
const api = existsSync(esm) ? await import(pathToFileURL(esm).href)
  : createRequire(import.meta.url)(resolve(root, 'Carburetor/index.js'));
class Store extends api.Carburetor { run(fn) { this.update(fn); } }
const results = [];
for (const [label, proto] of [['array', Array.prototype], ['null', null], ['object', Object.prototype]]) {
  for (const shape of ['dense', 'sparse']) {
    const rows = shape === 'dense' ? [{n: 0}, {n: 7}] : [];
    if (shape === 'sparse') { rows.length = 16; rows[0] = {n: 0}; rows[9] = {n: 7}; }
    Object.setPrototypeOf(rows, proto);
    const s = new Store({rows, spare: 0});
    let graph = [], projected = [], scalar = [], spare = 0, diagnostics = [];
    const error = console.error;
    console.error = (...args) => { diagnostics.push(args.map(String).join(' ')); };
    const stopGraph = s.watch(d => d.rows, (next, previous) => {
      graph.push({n: next[0].n, old: previous[0].n, length: next.length,
        prototypeCorrect: Object.getPrototypeOf(next) === proto,
        holesCorrect: shape !== 'sparse' || (!Object.hasOwn(next, 1) && !Object.hasOwn(next, 8)),
        heldCorrect: previous[0].n === 0,
        untouchedShared: next[shape === 'dense' ? 1 : 9] === previous[shape === 'dense' ? 1 : 9]});
    });
    const stopProjected = s.watch(d => ({rows: d.rows}), next => projected.push(next.rows[0].n));
    const stopScalar = s.watch(d => d.rows[0].n, n => scalar.push(n));
    const stopSpare = s.watch(d => d.spare, () => spare++);
    try {
      s.run(d => { d.rows[0].n = 0; });
      assert.deepEqual([graph.length, projected.length, scalar.length, diagnostics.length], [0, 0, 0, 0]);
      s.run(d => { d.rows[0].n = 1; });
      assert.equal(s.getData().rows[0].n, 1); assert.equal(s.getVersion(), 1);
      assert.deepEqual(projected, [1]); assert.deepEqual(scalar, [1]); assert.equal(spare, 0);
      if (label === 'array') {
        assert.equal(graph.length, 1);
        assert.ok(graph[0].prototypeCorrect && graph[0].holesCorrect && graph[0].heldCorrect && graph[0].untouchedShared);
      }
      results.push({label, shape, raw: s.getData().rows[0].n, graph, projected, scalar, spare,
        diagnostics, missingGraphDelivery: graph.length !== 1});
    } finally { stopGraph(); stopProjected(); stopScalar(); stopSpare(); console.error = error; }
  }
}
console.log(JSON.stringify({node: process.version, root, results}));
~~~

#### S01 stdout — esm-prod

~~~json
{"node":"v24.12.0","root":"D:\\dev\\ReactCarburetor\\worktrees\\bench-dist\\acfd3e2b8e58\\esm-prod","results":[{"label":"array","shape":"dense","raw":1,"graph":[{"n":1,"old":0,"length":2,"prototypeCorrect":true,"holesCorrect":true,"heldCorrect":true,"untouchedShared":true}],"projected":[1],"scalar":[1],"spare":0,"diagnostics":[],"missingGraphDelivery":false},{"label":"array","shape":"sparse","raw":1,"graph":[{"n":1,"old":0,"length":16,"prototypeCorrect":true,"holesCorrect":true,"heldCorrect":true,"untouchedShared":true}],"projected":[1],"scalar":[1],"spare":0,"diagnostics":[],"missingGraphDelivery":false},{"label":"null","shape":"dense","raw":1,"graph":[],"projected":[1],"scalar":[1],"spare":0,"diagnostics":[],"missingGraphDelivery":true},{"label":"null","shape":"sparse","raw":1,"graph":[],"projected":[1],"scalar":[1],"spare":0,"diagnostics":[],"missingGraphDelivery":true},{"label":"object","shape":"dense","raw":1,"graph":[],"projected":[1],"scalar":[1],"spare":0,"diagnostics":[],"missingGraphDelivery":true},{"label":"object","shape":"sparse","raw":1,"graph":[],"projected":[1],"scalar":[1],"spare":0,"diagnostics":[],"missingGraphDelivery":true}]}
~~~

### S02 source — unused owned endpoints after opacity

~~~js
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root = resolve(process.env.DIST_ROOT);
const esm = resolve(root, 'Carburetor/index.mjs');
const api = existsSync(esm) ? await import(pathToFileURL(esm).href)
  : createRequire(import.meta.url)(resolve(root, 'Carburetor/index.js'));
class Store extends api.Carburetor { run(fn) { this.update(fn); } }
class Meter extends api.CarburetorHistory {
  events = []; boundaries = [];
  onPatch(patch) {
    const opaqueBefore = this.pendingOpaque;
    const original = Reflect.ownKeys; let visits = 0;
    Reflect.ownKeys = value => { visits++; return original(value); };
    try { super.onPatch(patch); }
    finally { Reflect.ownKeys = original; }
    this.events.push({opaqueBefore, visits, pending: this.pendingPatches.length});
  }
  record(fact) {
    const boundary = {opaque: this.pendingOpaque, pending: this.pendingPatches.length};
    super.record(fact);
    this.boundaries.push({...boundary, kind: this.past.at(-1)?.kind ?? 'none'});
  }
}
const savedOwnKeys = Reflect.ownKeys;
const results = [];
for (const [n, k] of [[4, 1], [32, 1], [32, 3]]) {
  for (const mode of ['no-op', 'plain-only', 'native-first', 'native-last']) {
    const s = new Store({stamp: null, slot: null, keep: {n: 7}});
    const h = new Meter(s); let changes = 0, spare = 0;
    const stop = s.watch(d => d.slot?.rows[0].n ?? null, () => changes++);
    const stopSpare = s.watch(d => d.keep.n, () => spare++);
    try {
      s.run(d => {
        if (mode === 'no-op') return;
        if (mode === 'native-first') d.stamp = new Date(1000);
        for (let i = 1; i <= k; i++) {
          if (i > 1) d.slot = null;
          d.slot = {rows: Array.from({length: n}, (_, row) => ({n: i + row}))};
        }
        if (mode === 'native-last') d.stamp = new Date(1000);
      });
      const events = h.events.slice(), boundary = h.boundaries.at(-1) ?? {opaque: false, pending: 0, kind: 'none'};
      const afterOpaqueVisits = events.filter(e => e.opaqueBefore).reduce((a, e) => a + e.visits, 0);
      if (mode === 'no-op') {
        assert.equal(h.canUndo(), false); assert.equal(changes, 0);
      } else {
        assert.equal(changes, 1); assert.equal(s.getData().slot.rows[0].n, k);
        assert.equal(h.undo(), true); assert.equal(s.getData().slot, null); assert.equal(s.getData().stamp, null);
        assert.equal(h.redo(), true); assert.equal(s.getData().slot.rows[0].n, k);
        if (mode !== 'plain-only') assert.equal(s.getData().stamp.getTime(), 1000);
        assert.equal(changes, 3);
      }
      assert.equal(spare, 0); assert.equal(s.getData().keep.n, 7);
      assert.equal(Reflect.ownKeys, savedOwnKeys);
      results.push({n, k, mode, patchEvents: events.length,
        patchOwnVisits: events.reduce((a, e) => a + e.visits, 0), afterOpaqueVisits,
        boundary, endpointsCorrect: true, changes, spare});
    } finally { stop(); stopSpare(); h.disconnect(); }
  }
}
console.log(JSON.stringify({node: process.version, root, results}));
~~~

#### S02 stdout — esm-prod

~~~json
{"node":"v24.12.0","root":"D:\\dev\\ReactCarburetor\\worktrees\\bench-dist\\acfd3e2b8e58\\esm-prod","results":[{"n":4,"k":1,"mode":"no-op","patchEvents":0,"patchOwnVisits":0,"afterOpaqueVisits":0,"boundary":{"opaque":false,"pending":0,"kind":"none"},"endpointsCorrect":true,"changes":0,"spare":0},{"n":4,"k":1,"mode":"plain-only","patchEvents":1,"patchOwnVisits":6,"afterOpaqueVisits":0,"boundary":{"opaque":false,"pending":1,"kind":"patches"},"endpointsCorrect":true,"changes":3,"spare":0},{"n":4,"k":1,"mode":"native-first","patchEvents":2,"patchOwnVisits":7,"afterOpaqueVisits":6,"boundary":{"opaque":true,"pending":1,"kind":"snapshot"},"endpointsCorrect":true,"changes":3,"spare":0},{"n":4,"k":1,"mode":"native-last","patchEvents":2,"patchOwnVisits":7,"afterOpaqueVisits":0,"boundary":{"opaque":true,"pending":1,"kind":"snapshot"},"endpointsCorrect":true,"changes":3,"spare":0},{"n":32,"k":1,"mode":"no-op","patchEvents":0,"patchOwnVisits":0,"afterOpaqueVisits":0,"boundary":{"opaque":false,"pending":0,"kind":"none"},"endpointsCorrect":true,"changes":0,"spare":0},{"n":32,"k":1,"mode":"plain-only","patchEvents":1,"patchOwnVisits":34,"afterOpaqueVisits":0,"boundary":{"opaque":false,"pending":1,"kind":"patches"},"endpointsCorrect":true,"changes":3,"spare":0},{"n":32,"k":1,"mode":"native-first","patchEvents":2,"patchOwnVisits":35,"afterOpaqueVisits":34,"boundary":{"opaque":true,"pending":1,"kind":"snapshot"},"endpointsCorrect":true,"changes":3,"spare":0},{"n":32,"k":1,"mode":"native-last","patchEvents":2,"patchOwnVisits":35,"afterOpaqueVisits":0,"boundary":{"opaque":true,"pending":1,"kind":"snapshot"},"endpointsCorrect":true,"changes":3,"spare":0},{"n":32,"k":3,"mode":"no-op","patchEvents":0,"patchOwnVisits":0,"afterOpaqueVisits":0,"boundary":{"opaque":false,"pending":0,"kind":"none"},"endpointsCorrect":true,"changes":0,"spare":0},{"n":32,"k":3,"mode":"plain-only","patchEvents":5,"patchOwnVisits":170,"afterOpaqueVisits":0,"boundary":{"opaque":false,"pending":3,"kind":"patches"},"endpointsCorrect":true,"changes":3,"spare":0},{"n":32,"k":3,"mode":"native-first","patchEvents":6,"patchOwnVisits":171,"afterOpaqueVisits":170,"boundary":{"opaque":true,"pending":3,"kind":"snapshot"},"endpointsCorrect":true,"changes":3,"spare":0},{"n":32,"k":3,"mode":"native-last","patchEvents":6,"patchOwnVisits":171,"afterOpaqueVisits":0,"boundary":{"opaque":true,"pending":3,"kind":"snapshot"},"endpointsCorrect":true,"changes":3,"spare":0}]}
~~~

### S03 source — scalar final-path graph machinery

~~~js
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root = resolve(process.env.DIST_ROOT);
const esm = resolve(root, 'Carburetor/index.mjs');
const api = existsSync(esm) ? await import(pathToFileURL(esm).href)
  : createRequire(import.meta.url)(resolve(root, 'Carburetor/index.js'));
class Store extends api.Carburetor { run(fn) { this.update(fn); } }
class Meter extends api.CarburetorHistory {
  boundaries = [];
  record(fact) {
    const Original = globalThis.WeakMap;
    const originalDescriptor = Object.getOwnPropertyDescriptor;
    let weakmaps = 0, descriptors = 0;
    globalThis.WeakMap = class extends Original {
      constructor(...args) { super(...args); weakmaps++; }
    };
    Object.getOwnPropertyDescriptor = (...args) => { descriptors++; return originalDescriptor(...args); };
    try { super.record(fact); }
    finally { globalThis.WeakMap = Original; Object.getOwnPropertyDescriptor = originalDescriptor; }
    this.boundaries.push({origin: fact?.origin ?? 'none', weakmaps, descriptors});
  }
}
const results = [];
for (const p of [1, 8, 32, 64]) {
  for (const mode of ['repeat', 'distinct', 'separate']) {
    const fields = mode === 'distinct' ? Object.fromEntries(Array.from({length: p}, (_, i) => ['n' + i, 0])) : {n: 0};
    const s = new Store({box: fields, spare: {n: 7}}), h = new Meter(s, {limit: p + 1});
    let ordinary = 0, spare = 0;
    const id = s.subscribe(() => ordinary++), stop = s.watch(d => d.spare.n, () => spare++);
    try {
      const edit = (d, i) => { if (mode === 'distinct') d.box['n' + i] = 1; else d.box.n = i + 1; };
      if (mode === 'separate') for (let i = 0; i < p; i++) s.run(d => edit(d, i));
      else s.run(d => { for (let i = 0; i < p; i++) edit(d, i); });
      const recorded = h.past.at(-1).patches.length;
      const writes = h.boundaries.slice(); h.boundaries = [];
      assert.equal(h.undo(), true);
      const undo = h.boundaries.at(-1); h.boundaries = [];
      if (mode === 'distinct') assert.ok(Object.values(s.getData().box).every(n => n === 0));
      else assert.equal(s.getData().box.n, mode === 'separate' ? p - 1 : 0);
      assert.equal(h.redo(), true);
      const redo = h.boundaries.at(-1); h.boundaries = [];
      if (mode === 'distinct') assert.ok(Object.values(s.getData().box).every(n => n === 1));
      else assert.equal(s.getData().box.n, p);
      s.run(d => { if (mode === 'distinct') d.box.n0 = 1; else d.box.n = p; });
      assert.equal(h.boundaries.length, 0); assert.equal(spare, 0);
      assert.equal(ordinary, (mode === 'separate' ? p : 1) + 2);
      results.push({p, mode, recorded, writeWeakmaps: writes.reduce((a, b) => a + b.weakmaps, 0),
        undo, redo, noOpBoundaries: h.boundaries.length, ordinary, spare, endpointsCorrect: true});
    } finally { stop(); s.unsubscribe(id); h.disconnect(); }
  }
}
const s = new Store({slot: null}), h = new Meter(s);
try {
  s.run(d => { d.slot = {n: 1, child: {n: 2}}; }); h.boundaries = [];
  assert.equal(h.undo(), true); assert.equal(s.getData().slot, null); h.boundaries = [];
  assert.equal(h.redo(), true); assert.equal(s.getData().slot.child.n, 2);
  console.log(JSON.stringify({node: process.version, root, results, graphPositive: h.boundaries.at(-1)}));
} finally { h.disconnect(); }
~~~

#### S03 stdout — esm-prod

~~~json
{"node":"v24.12.0","root":"D:\\dev\\ReactCarburetor\\worktrees\\bench-dist\\acfd3e2b8e58\\esm-prod","results":[{"p":1,"mode":"repeat","recorded":1,"writeWeakmaps":0,"undo":{"origin":"restore","weakmaps":2,"descriptors":4},"redo":{"origin":"restore","weakmaps":2,"descriptors":4},"noOpBoundaries":0,"ordinary":3,"spare":0,"endpointsCorrect":true},{"p":1,"mode":"distinct","recorded":1,"writeWeakmaps":0,"undo":{"origin":"restore","weakmaps":2,"descriptors":4},"redo":{"origin":"restore","weakmaps":2,"descriptors":4},"noOpBoundaries":0,"ordinary":3,"spare":0,"endpointsCorrect":true},{"p":1,"mode":"separate","recorded":1,"writeWeakmaps":0,"undo":{"origin":"restore","weakmaps":2,"descriptors":4},"redo":{"origin":"restore","weakmaps":2,"descriptors":4},"noOpBoundaries":0,"ordinary":3,"spare":0,"endpointsCorrect":true},{"p":8,"mode":"repeat","recorded":8,"writeWeakmaps":0,"undo":{"origin":"restore","weakmaps":16,"descriptors":32},"redo":{"origin":"restore","weakmaps":16,"descriptors":32},"noOpBoundaries":0,"ordinary":3,"spare":0,"endpointsCorrect":true},{"p":8,"mode":"distinct","recorded":8,"writeWeakmaps":0,"undo":{"origin":"restore","weakmaps":16,"descriptors":32},"redo":{"origin":"restore","weakmaps":16,"descriptors":32},"noOpBoundaries":0,"ordinary":3,"spare":0,"endpointsCorrect":true},{"p":8,"mode":"separate","recorded":1,"writeWeakmaps":0,"undo":{"origin":"restore","weakmaps":2,"descriptors":4},"redo":{"origin":"restore","weakmaps":2,"descriptors":4},"noOpBoundaries":0,"ordinary":10,"spare":0,"endpointsCorrect":true},{"p":32,"mode":"repeat","recorded":32,"writeWeakmaps":0,"undo":{"origin":"restore","weakmaps":64,"descriptors":128},"redo":{"origin":"restore","weakmaps":64,"descriptors":128},"noOpBoundaries":0,"ordinary":3,"spare":0,"endpointsCorrect":true},{"p":32,"mode":"distinct","recorded":32,"writeWeakmaps":0,"undo":{"origin":"restore","weakmaps":64,"descriptors":128},"redo":{"origin":"restore","weakmaps":64,"descriptors":128},"noOpBoundaries":0,"ordinary":3,"spare":0,"endpointsCorrect":true},{"p":32,"mode":"separate","recorded":1,"writeWeakmaps":0,"undo":{"origin":"restore","weakmaps":2,"descriptors":4},"redo":{"origin":"restore","weakmaps":2,"descriptors":4},"noOpBoundaries":0,"ordinary":34,"spare":0,"endpointsCorrect":true},{"p":64,"mode":"repeat","recorded":64,"writeWeakmaps":0,"undo":{"origin":"restore","weakmaps":128,"descriptors":256},"redo":{"origin":"restore","weakmaps":128,"descriptors":256},"noOpBoundaries":0,"ordinary":3,"spare":0,"endpointsCorrect":true},{"p":64,"mode":"distinct","recorded":64,"writeWeakmaps":0,"undo":{"origin":"restore","weakmaps":128,"descriptors":256},"redo":{"origin":"restore","weakmaps":128,"descriptors":256},"noOpBoundaries":0,"ordinary":3,"spare":0,"endpointsCorrect":true},{"p":64,"mode":"separate","recorded":1,"writeWeakmaps":0,"undo":{"origin":"restore","weakmaps":2,"descriptors":4},"redo":{"origin":"restore","weakmaps":2,"descriptors":4},"noOpBoundaries":0,"ordinary":66,"spare":0,"endpointsCorrect":true}],"graphPositive":{"origin":"restore","weakmaps":2,"descriptors":8}}
~~~

## Verification limits и порядок независимой проверки

1. Parent независимо исполняет S01 на supplied frozen base, сверяет не только discrepancy flag, но raw version/value, scalar/full positive controls, zero unmatched deliveries и development diagnostic. Проверку actual hook/class/resource-reader committed UI здесь нельзя заменить source reachability.
2. Parent отдельно исполняет S02 и S03, убеждается, что instrumentation действительно ограничена `super.onPatch` / `super.record`, controls чувствительны, intrinsics восстанавливаются. Не объединять counters и uninstrumented latency windows.
3. Если findings будут реализованы, один orchestrator запускает affected selection/patching/prototype/sparse/history replay/cancellation/ownership suites, а затем существующий и новый benchmark runner один раз после integration. В этом review все такие команды намеренно **не исполнены**.

Фактический scope evidence: S01 six bounded cases per format; S02 twelve cases per format; S03 twelve scalar cases + one graph positive per format. Matrix не является exhaustive proof всех descriptor/topology/reentry combinations. Проб с NativeAliasIndex cache invalidation/GC, constructor-byte allocation, wall-clock throughput, InstructionRetired, browser DOM, CPU/heap pressure либо hardware traces нет. Public API cutover не предлагается; repository references понадобятся заново, если реализация решит изменить protected/public contract вместо локальных helpers.

Отчёт завершён как review deliverable: три source-backed, independently runnable findings, без production implementation и без ослабления прежних acceptance. Перед hand-off не запускались tests/build/lint/formatter или git validation commands.

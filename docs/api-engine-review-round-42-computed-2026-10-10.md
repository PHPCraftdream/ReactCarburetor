# API / engine review — раунд 42: Computed, граф и freshness

Дата: **2026-10-10**. Reviewed base: **`fa1ad08f8cd6b26f175235a435976fcb9d94dd22`**.
Тема: dependency graph, leaf-version capture, eager/cached reads, observer lifetime, recorder ownership и публичный `computed(body, {equals})`.

Это **review-only**, не реализация оптимизаций. Production, tests, benchmarks и конфигурация не менялись. Сборка, suite, lint, formatter и perf runner не запускались. Переданный orchestrator статус опубликованной базы — GREEN CI `38075943238`, 11/11 jobs; этот отчёт не перепроверяет удалённый CI и не заменяет его.

## Резюме

| ID | Приоритет | Симптом / стоимость | Production source | Доказательство |
|---|---|---|---|---|
| **R42-C01** | **P1, correctness** | Merge двух уже merged leaf records теряет первую группу paths. Unobserved `get()` возвращает 10 вместо 20; observed eager pull внутри transaction тоже отдаёт 10, хотя после drain приходит правильное 20 | [`captureLeafVersions.ts:27–35`](../lib/src/Carburetor/Derived/Freshness/captureLeafVersions.ts#L27), [`leafVersionsDrifted.ts:22–29`](../lib/src/Carburetor/Derived/Freshness/leafVersionsDrifted.ts#L22) | Actual public-runtime repro, positive/negative controls, 4 compiled formats; read-only metadata corroboration |
| **R42-C02** | **P2, performance / allocation work** | Shared-leaf fan-in копирует всё накопленное `parts` на каждом merge. При K=8/16/32 один настоящий observed update перечисляет 35/135/527 constituent references, хотя итоговый массив имеет K элементов | [`captureLeafVersions.ts:18–32`](../lib/src/Carburetor/Derived/Freshness/captureLeafVersions.ts#L18) | Actual bounded whole-update mechanism counter и controls; **[INFERENCE] Θ(K²)** reference-copy member, без byte/latency claim |
| **R42-C03** | **P2, API correctness / лишняя delivery** | `undefined` принят за отсутствие equality baseline: nullish-equivalent `undefined→null` не вызывает comparator и публикуется; обратный переход подавляется | [`announceIsUnchanged.ts:37–47`](../lib/src/Carburetor/Derived/Freshness/announceIsUnchanged.ts#L37), [`Derived.ts:23–33`](../lib/src/Carburetor/Models/Derived.ts#L23) | Actual observed/unobserved runtime repro, обратный переход и cold-evaluation controls, 4 compiled formats |

Рекомендуемый порядок: C01, затем C03; C02 — после сохранения полного constituent coverage. C01/C02 находятся в одной функции, но это независимые acceptance: lossless merge и линейное построение output metadata. Здесь не заявлены fixed optimizations или measured speedups.

## Метод и границы

- Прочитаны текущие `Derived/Computed.ts`, `computedDependencies.ts`, `Models.ts`, `computedFactory.ts`, `reportComputedEscape.ts`, все freshness helpers; смежные `PersistentViewCache.ts`, native-epoch eligibility и `UpdateWave.ts`.
- Сопоставлены `__tests__/Engine/Derived/computed41/{Dependencies,Lifecycle}.test.ts`, Computed Core/ExoticResults и freshness LeafVersionMerge/RetainedIdentity/DeferredFreshness; существующие computed/computed41/derived scenarios и gates. Это чтение, **не исполнение тестов**.
- Отдельного `docs/computed.md` в этой базе нет: актуальный контракт расположен в [`README.md:373–445`](../README.md#L373) и `Models/Derived.ts`.
- Novelty: прочитаны R41 resolution `:238–337`, R40, связанные R32/R33/R34 findings/resolutions и intentional limits R37 `:39–43`, R39 `:60–66,118–121`. Не переобъявляются symbol cutover, O(D) fresh membership, last-release announcement/strong filing, recorder lexical-scope fix или уже отмеченные native/selection/WriteLog floors.
- `xd://lsp` недоступен: device ответил `No such tool: xd://lsp` (смонтированы ast_edit/debug). Definitions/references установлены чтением текущих исходников, не выдуманными LSP-ответами.
- Пробы запускают реальный переданный `dist` **read-only** из назначенного worktree, без сборки и source patching. Node **v24.12.0**, установленный React **19.3.0**; React rendering в этой теме не запускался.
- `realpathSync('./dist')` во всех четырёх процессах: `D:\dev\ReactCarburetor\worktrees\bench-dist\fa1ad08f8cd6`. Связь этого compiled distribution с полным reviewed SHA предоставлена orchestrator; локальный `git log -1` показал этот SHA и ветку `review-r42-computed-20261010`.

## R42-C01 — потеря constituent paths при merged + merged

### Проблема и механизм

Граф над **одним** native store:

```text
store {a:1,b:2,c:3,d:4,noise:0}
  A=read(store).a, B=read(store).b, C=read(store).c, D=read(store).d
  left=A+B                   right=C+D
             total=left+right
```

`left` и `right` уже имеют leaf record с `parts` и **без `reads`**. В `addLeafVersion` оба `reads` равны `undefined`; условие `previous.reads !== recorded.reads` ложно. Выполняется `versions[id] = recorded`, а не union constituent pairs. `total` сохраняет только правую группу `{c,d}`. Это не допустимая identity-equal read-set оптимизация: здесь равны отсутствующие поля, а не содержимое или identity частей.

`leafVersionsDrifted` видит изменившуюся public store version, но `leafDrifted` проверяет только оставшиеся `parts`. Write `a += 10` объявляется нерелевантным; `Computed.hasDrifted` затем принимает текущий native epoch (`Computed.ts:219–232`). Числовой результат не попадает в conservative live-result replacement branch.

### Наблюдение

Все значения ниже получены в **cjs, cjs-prod, esm, esm-prod**; initial всегда 10. Каждый case строит независимый граф.

| Shape / действие | Captured parts до write | Eager pull / следующий get | Deliveries | Вывод |
|---|---|---|---|---|
| merged + merged, unobserved, `a += 10` | `c,d` | **10 / 10**, ожидается 20 | `[]` | ошибка сохраняется и на следующем cached read; все 7 body counters остаются 1 |
| Тот же граф, `c += 10` | `c,d` | 20 / 20 | `[]` | положительный контроль оставшейся группы |
| Reverse order `right+left`, `a += 10` | `a,b` | 20 / 20 | `[]` | membership зависит от порядка обхода, не от действительного dependency graph |
| Flat `A+B+C+D`, `a += 10` | `a,b,c,d` | 20 / 20 | `[]` | базовый fan-in исправен |
| merged + bare `left+C+D`, `a += 10` | `a,b,c,d` | 20 / 20 | `[]` | уже исправленный earlier merged-plus-bare маршрут исправен |
| merged + merged, `noise += 10` | `c,d` | 10 / 10 | `[]` | unrelated write не должен менять значение |
| merged + merged, observed, `a += 10` внутри transaction | `c,d` | **10 внутри**, 20 после drain | `[20]` | обычная invalidation graph delivery маскирует ошибку pull freshness |

Black-box ошибка состоит в public `get()`; internal `computedDependencies.versions` только объясняет потерянные paths. Ветка observer delivery после transaction сохранилась: не следует описывать находку как «все уведомления пропали».

### Безопасное действие и tradeoffs

Сделать merge **lossless** для bare+bare, parts+bare, bare+parts и parts+parts; одинаковость отсутствующих `reads` не является proof equivalence. Сохранить constituent `{version, reads}` identities, требуемые store O(1) filed-pair drift answers. Настоящий одинаковый record можно переиспользовать, но нельзя отбрасывать отличную группу.

Не исправлять симптом глобальным отказом от native epoch shortcut, wildcard подпиской или повторным исполнением всех bodies при каждом `get()`: это меняет precision/cost и оставляет повреждённую metadata. Public API менять не требуется. **[INFERENCE]** Корректный leaf snapshot может содержать больше частей, чем нынешний ошибочно усечённый; это необходимая correctness cost, а не измеренная регрессия. Строить его линейно по действительно включённым constituent pairs — совместный контракт C02, без прежнего copy-per-merge.

### Invariants и adversarial cases

- Drift — OR по **всем** constituent paths, независимо от порядка direct dependencies, глубины и одинакового store UID у shared leaf.
- Нельзя мутировать upstream `parts`/`reads` или прежний announcement snapshot. Current evaluation и announced baseline остаются независимыми.
- Проверить оба порядка sibling groups, writes в каждой группе, повторное включение одного настоящего record, overlapping constituent read sets, nested merged groups и независимые stores.
- Проверить observed/unobserved reads, transaction/throttle eager pull, replaced native data object, external leaves и mixed-format graph. Последние дополнительные комбинации **не исполнены** в этой review-фазе.
- Нельзя терять per-part version или заменять filed Set новым union Set: это вернёт R34-01 write-log walks. Одна и та же reads identity с разными captured versions не обязана быть одним безопасно coalesced pair.

### Новый benchmark и старые gates

Предложить `computed42/merged-pair-freshness`: реальный native store, минимум две merged sibling groups; записывать каждую группу в обоих порядках, eager reads до drain и отдельный unobserved маршрут. Gates: arithmetic checksum на **каждом** pull, ровно одна final publication на observed transaction, ноль unrelated body runs, сохранение upstream/old parts. Такой текущий runtime должен провалить именно freshness verdict, а не timing cap.

Сохранить `computed/diamond-ladder@26`, `computed/diamond-ladder@26-control`, `computed/pulls@1`, `computed/pulls@128`, native/external freshness, `derived/drift-fan-in@10k`, `derived/r32-fan-in@1600`, `derived/r32-fan-in-control@1600`, `computed41/dependencies-*`, `computed41/observer-lifetime`. Существующие LeafVersionMerge/RetainedIdentity проверяют bare fan-in и third **bare** constituent; `RetainedIdentity.test.tsx:119–142` назван nested, но его stand-ins также дают по одному bare record. Это не coverage двух merged inputs.

## R42-C02 — квадратичный accumulated-parts copy

### Проблема и отличие от прежних rounds

R32-02 устранил copying накопленного **Set paths**; R34-01 сохранил исходные filed sets как constituent pairs. Нынешний `parts: [...partsOf(previous), ...partsOf(recorded)]` всё ещё заново перечисляет накопленный **array of pair references** при каждом новом bare input.

Это не повтор R41-03 `fresh.includes` (теперь membership O(D)) и не утверждение, что снова копируются Set entries. Оставшийся член — array element copying в version capture. Старые fan-in gates измеряют `Set` constructors/adds; сохранив их линейность, можно по-прежнему платить за эту работу.

### Actual runtime evidence

Observed total читает K leaf computeds, каждый — отдельный `p_i` общего native store. После mount выполняется **один настоящий `store.update(p0++)`**, включающий invalidation, recompute, metadata capture и settlement. В этом окне обёрнут `Array.prototype[Symbol.iterator]`; считаются yielded elements только массивов с pair shape `{version, reads: Set}` без `source`. Wrapper восстановлен в `finally`. Byte allocation и время не измеряются; wrapper сам создаёт объекты, поэтому его результаты нельзя использовать как heap-byte/latency оценку engine.

| K / source layout | Counted constituent references | Final parts | Initial → current | Total body runs mount+write | Deliveries |
|---|---:|---:|---|---:|---:|
| 8, shared store | **35** | 8 | 28 → 29 | 2 | 1 |
| 16, shared store | **135** | 16 | 120 → 121 | 2 | 1 |
| 32, shared store | **527** | 32 | 496 → 497 | 2 | 1 |
| 32, distinct store per leaf | **0** | 0 | 496 → 497 | 2 | 1 |

Empty window — 0; explicit spread двух pair records — 2 (positive counter control). Captured старый parts array сохраняет длину K после recompute. Все четыре compiled formats дали эти же числа.

**[INFERENCE — static complexity отдельно]** На merge j=2..K перечисляются j references. Сумма `2+3+...+K = K(K+1)/2−1`: 35/135/527 совпадают с execution. Итоговый retained array имеет O(K) references; сумма промежуточного copy work — **Θ(K²)** при фиксированном числе paths на leaf. Это не доказательство total allocated bytes, всех engine allocations, wall-clock slowdown или performance win будущего исправления.

### Безопасное действие и tradeoffs

Создавать один **capture-owned** accumulator для данного shared leaf и append каждый включённый pair один раз вместо spread accumulated prefix на каждой итерации. Borrowed upstream `parts` копируются перед первым local mutation; «append прямо в первый увиденный массив» нарушит cache/announcement isolation. Read sets остаются исходными filed Set objects; не возвращаться к copied union Set. Не нужен public cache, reusable tracking proxy или новая subscription abstraction.

Public API и delivery semantics неизменны; **[INFERENCE]** Для flat fan-in builder reference work может стать O(K), но общий update сохраняет body, edge, subscription и version costs. Latency/byte win остаётся **unverified**. Глубокий DAG с повторным shared constituent требует отдельного coverage; линейность по уникальным graph leaves здесь не доказана и не обещается.

### Invariants, новый benchmark и старые gates

- Все K constituent pairs доступны drift checker; C01 не должен быть «оптимизацией» через усечение output.
- Upstream metadata, предыдущий evaluation и announced snapshots не мутируются; per-part versions и Set identities сохраняются. Equal result не снимает актуальные subscriptions; rollback и last release сохраняют свои поколения.
- Новый `computed42/fan-in-part-work`: K=100/400/1600, fixed M и shared/distinct controls. Отдельно считать pair-reference work, finite array copy/append work и правильный result/delivery; counter имеет empty и known-copy positive controls. Future safe implementation gate — O(K) builder work, не только неизменный Set work.
- Для latency proof отдельно сравнить целую `update+get` на baseline/fix в quiet serial processes, с одинаковыми checksums, body/delivery/subscription counts. Для byte claim нужна соответствующая allocation measurement, а не этот iterator counter. Такие размеры/A-B/GC runs **не запускались**.
- Старые gates: `derived/r32-fan-in@1600`, `derived/r32-fan-in-control@1600` (включая sums, outerRuns и Set control), `derived/drift-fan-in@10k`, retained-identity freshness tests, `computed41/dependencies-*`, diamond-ladder и observer-lifetime. Они защищают прежние costs, но alone не обнаруживают array-prefix copying.

## R42-C03 — legitimate undefined baseline пропускает equals

### Проблема и actual evidence

`IComputedOptions<R>.equals` не исключает `undefined` из R. Политика «`null` и `undefined` оба обозначают отсутствие результата» — корректная симметричная equivalence policy. Однако `contentSame` проверяет `baseline !== undefined`. Существующий announcement `{value: undefined, versions}` и ранее вычисленный unobserved `undefined` ошибочно трактуются как отсутствие baseline.

Probe: native store `{present: start}`, body `read(store).present ? null : undefined`, comparator фиксирует пары аргументов и возвращает `before == null && after == null`. Один write переворачивает `present`.

| Маршрут | Начальное значение | Comparator calls на write | Current `get()` | getVersion | Deliveries |
|---|---|---|---|---:|---|
| observed `undefined→null` | `undefined` | **0** | **null** | **1** | **[null]** |
| observed `null→undefined` | `null` | 1, `[null,undefined]` | null (baseline сохранён) | 0 | `[]` |
| unobserved `undefined→null` | `undefined` | **0** | **null** | 0 | `[]` |
| unobserved `null→undefined` | `null` | 1, `[null,undefined]` | null (baseline сохранён) | 0 | `[]` |

Initial comparator calls — 0 во всех четырёх маршрутах. Все cjs/cjs-prod/esm/esm-prod outputs совпали. Лишняя **computed delivery** измерена; дополнительные React renders — только **[INFERENCE]**, React consumer здесь не запускался.

### Безопасное действие и tradeoffs

Разделить **наличие successful baseline** и значение baseline. Observed наличие уже выражено `announcement !== undefined`; unobserved recompute располагает `hadValue` (`Computed.ts:273–295`). Передать этот смысл internal equality helper, не кодировать его значением R. Cold first result не сравнивать; subsequent successful `undefined` — полноценный baseline.

Public signature не меняется. Preserve Object.is short circuit, canonical live identity, exotic in-place mutation carve-out и baseline reference retention R33-05. Не следует «исправлять» это запретом undefined, специальным nullish default comparator или дополнительной validation. **[INFERENCE]** Добавляется comparator call там, где пользователь уже запросил эту политику; он может иметь свою цену/throw, и существующий error/settlement contract должен сохраниться. Нет новой machinery per stable get.

### Invariants, adversarial cases и benchmark

- Cold undefined/null, observed/unobserved undefined baseline, both directions, comparator true/false, same-reference control, NaN/-0 и comparator throw.
- Accepted equal result сохраняет исходное значение (в failing direction — undefined), не меняет delivered version и не публикуется. Equality не должна мешать migration dependency sets.
- Stable-reference live/exotic mutation продолжает публиковаться даже при always-equal comparator; не расширять equals на aliasing mutated baseline.
- Новый `computed42/undefined-equals`: реальные writes в обе стороны + observed/unobserved lanes; gates на exact comparator argument pairs, current value, version и deliveries, cold calls=0. Опциональный React lane может доказать render consequence; он **unverified**.
- Сохранить `Computed/Core.test.tsx:8–29`, `ExoticResults.test.tsx:417–507`, `computed/equals-list@20`, hook-publication, deferred equal-primitive и public-collision gates. R33-05 исправлен для проверенных object/array baselines; новый repro — distinct undefined-sentinel gap, не повтор claim «equals вообще не сохраняет identity».

## Rejected candidates, intentional floors и retention

1. **R40/R41 private-name collision, fresh membership, obsolete observer retention.** Не новые находки. Symbols/fresh flags/independent announcement release присутствуют. Tiny controls после last release фактически увидели `announcedCleared=true`, `activeReadSlots=0`; resubscribe и следующий write снова доставляют. Это state-cleanup evidence, **не новый GC proof**.
2. **Strong evaluation cache как «утечка».** `releaseDependencies` намеренно не очищает value/versions (`Computed.ts:445–458`; README `:394–400`). После release native control имеет один cached leaf record; сохранение источника до замены evaluation — documented ownership, не genuine leak. GC/heap snapshots в этом round не снимались.
3. **Recorder identity/retired-source routes.** В tiny same-ID replacement control чтение сохранённого старого view и writes в unread right обоих stores дают 0 дополнительных bodies; actual replacement left write доставляет 11. Старый view всё ещё читает left=1, но не подписывает replacement. Slots закрыты на release. Factory lexical isolation и weak identity filing уже R41 resolution.
4. **«Нужен O(1) get и для external version source».** Отклонено. External source может менять public version без native epoch/delivery; observed total над двумя dependent branches имеет один upstream bridge, 8 stable pulls вызывают getVersion 8 раз, silent write читается как 9, delivery при следующем emit — 12. После last release upstream listeners=0, adds/removes=1/1. Убрать external version checks только на native epoch — correctness regression.
5. **Cached native/diamond read повторяет bodies.** В control: mount value=3; 8 stable pulls + unrelated native write дают body deltas `[0,0,0]`. Transaction pull=6 до delivery; после drain приходит `[6]`, каждый node исполняется ровно один раз на write, retained attach/release=0/0. После rejoin и write — 9, events `[6,9]`. Это не доказывает все DAG topologies — C01 как раз показывает отдельный omitted-parts случай.
6. **Fresh recorder closure на каждом `read(store)`.** Static observation: `Computed.ts:264,305–310` вызывает factory, даже если `PersistentViews.view` возвращает cached view (`:37–40`). Возможную bounded allocation можно исследовать отдельно, но whole-operation relevance/byte cost здесь не установлены. Не выдаётся за четвёртую actionable performance finding; separate factory scope нельзя вернуть внутрь recompute ради микрооптимизации (R41 retention).
7. **Read no paths / coarse computed result / ignored options.reads.** Это заявленные contracts: store paths возникают при настоящих reads; computed источник наблюдается как whole value. Не предлагать новый fine-path computed API без потребности. Symbol snapshot protocol и generic hook/class wrapper отдельно не ревьюились.
8. **R37/R39 known limits.** Structural/positional selection reconcile, immutable flat-array outer-spine copies, object-keyed native equality, cyclic key working set, native coarse/topology boundaries и ранее отмеченный `WriteLog.pathsSince` scan не переименованы в R42 findings. Source cross-path alias scan и generic Store selection engine вне этой темы.

## Точные команды, результаты и пределы доказательства

Все subprocess имели **cwd** `D:/dev/ReactCarburetor/worktrees/review-r42-computed-20261010`. Не запускать команды из primary checkout. Начальная identity-команда:

```text
git log -1 --format="%H%n%D"
```

stdout SHA: `fa1ad08f8cd6b26f175235a435976fcb9d94dd22`; HEAD — назначенная review branch.

Первичные изолированные CJS исследования также запускались через `subprocess.run(['node', '-e', code], cwd=worktree, ...)`: merge graph, pair-copy counter и undefined/null comparator. Основные результаты выше затем получены сохранённой полной воспроизводимой пробой, включающей те же shapes и дополнительные lifecycle/precision controls:

```text
node worktrees/r42-computed-probe.mjs cjs
node worktrees/r42-computed-probe.mjs cjs-prod
node worktrees/r42-computed-probe.mjs esm
node worktrees/r42-computed-probe.mjs esm-prod
```

Каждая команда завершилась **exit 0**, stderr пуст. Это исследовательские JSON probes, не assert-based suite: exit 0 не означает, что найденные incorrect values правильны. Фактический cjs stdout приведён ниже; остальные три отличаются только `format`, результаты и counters те же. Полные argv/cwd/stdout/stderr всех четырёх процессов сохранены в ignored `worktrees/r42-computed-receipts.json`. Сам executable probe тоже ignored, не входит в report commit; его полный текст включён в следующий раздел для воспроизведения после удаления worktree.

```jsonl
{"probe":"identity","format":"cjs","node":"v24.12.0","react":"19.3.0","dist":"D:\\dev\\ReactCarburetor\\worktrees\\bench-dist\\fa1ad08f8cd6"}
{"probe":"merge","format":"cjs","cases":[{"shape":"merged-plus-merged","field":"a","observed":false,"reverse":false,"initial":10,"expected":20,"initialParts":["c","d"],"during":10,"after":10,"deliveries":[],"runs":[1,1,1,1,1,1,1]},{"shape":"merged-plus-merged","field":"c","observed":false,"reverse":false,"initial":10,"expected":20,"initialParts":["c","d"],"during":20,"after":20,"deliveries":[],"runs":[1,1,2,1,1,2,2]},{"shape":"merged-plus-merged","field":"a","observed":false,"reverse":true,"initial":10,"expected":20,"initialParts":["a","b"],"during":20,"after":20,"deliveries":[],"runs":[2,1,1,1,2,1,2]},{"shape":"flat","field":"a","observed":false,"reverse":false,"initial":10,"expected":20,"initialParts":["a","b","c","d"],"during":20,"after":20,"deliveries":[],"runs":[2,1,1,1,0,0,2]},{"shape":"merged-plus-bare","field":"a","observed":false,"reverse":false,"initial":10,"expected":20,"initialParts":["a","b","c","d"],"during":20,"after":20,"deliveries":[],"runs":[2,1,1,1,2,0,2]},{"shape":"merged-plus-merged","field":"noise","observed":false,"reverse":false,"initial":10,"expected":10,"initialParts":["c","d"],"during":10,"after":10,"deliveries":[],"runs":[1,1,1,1,1,1,1]},{"shape":"merged-plus-merged","field":"a","observed":true,"reverse":false,"initial":10,"expected":20,"initialParts":["c","d"],"during":10,"after":20,"deliveries":[20],"runs":[2,1,1,1,2,1,2]}]}
{"probe":"fanin","format":"cjs","emptyControl":0,"positiveControl":2,"cases":[{"K":8,"shared":true,"initial":28,"current":29,"runs":2,"deliveries":1,"copiedRefs":35,"finalParts":8,"oldPartsUnchanged":true},{"K":16,"shared":true,"initial":120,"current":121,"runs":2,"deliveries":1,"copiedRefs":135,"finalParts":16,"oldPartsUnchanged":true},{"K":32,"shared":true,"initial":496,"current":497,"runs":2,"deliveries":1,"copiedRefs":527,"finalParts":32,"oldPartsUnchanged":true},{"K":32,"shared":false,"initial":496,"current":497,"runs":2,"deliveries":1,"copiedRefs":0,"finalParts":0,"oldPartsUnchanged":true}]}
{"probe":"equals","format":"cjs","cases":[{"start":false,"observed":true,"initial":"undefined","initialComparisons":0,"current":"null","version":1,"comparisons":[],"seen":["null"]},{"start":true,"observed":true,"initial":"null","initialComparisons":0,"current":"null","version":0,"comparisons":[["null","undefined"]],"seen":[]},{"start":false,"observed":false,"initial":"undefined","initialComparisons":0,"current":"null","version":0,"comparisons":[],"seen":[]},{"start":true,"observed":false,"initial":"null","initialComparisons":0,"current":"null","version":0,"comparisons":[["null","undefined"]],"seen":[]}]}
{"probe":"controls","format":"cjs","native":{"initial":3,"quietDeltas":[0,0,0],"during":6,"duringDeliveries":0,"changedDeltas":[1,1,1],"retainedAttach":0,"retainedRelease":0,"released":{"announcedCleared":true,"activeReadSlots":0,"cachedLeafCount":1},"final":9,"seen":[6,9],"attaches":2,"releases":2},"external":{"initial":3,"upstreamListeners":1,"stableVersionCalls":8,"silentPull":9,"final":12,"seen":[6,12],"attaches":1,"releases":1,"remainingListeners":0},"retiredRoute":{"unreadDeltas":0,"final":11,"retainedLeft":1,"seen":[10,11],"announcedCleared":true,"activeReadSlots":0}}
```

**Coverage limits:** четыре отдельных runtime formats, не mixed-format/packed matrix; numeric/native shared-leaf inputs и один external adapter. Не запускались React/SSR/hydration, throttle, randomized graph differential, heavy K sweeps, GC liveness, heap/allocation-byte measurement, CPU profiles, full tests/perf/CI. Не строился fix/prototype и не проводился before/after whole-operation A/B. Поэтому proposals не являются подтверждёнными исправлениями, а counters не обещают latency speedup.

После реализации orchestrator должен отдельно запустить перечисленные old gates/tests; новый benchmark нужен для каждого нового механизма. Сейчас никаких production/permanent-test/perf edits нет.

## Полный executable light probe

В назначенном worktree сохранить этот текст как ignored `worktrees/r42-computed-probe.mjs`, использовать уже предоставленный `dist` и запустить четыре команды выше. Импорты разрешаются относительно **cwd**, shared junction targets только читаются. Instrumentation заменяет iterator только в synchronous counter window и восстанавливает его в `finally`; internal metadata читается, но не изменяется.

```js
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const require = createRequire(import.meta.url);
const format = process.argv[2] ?? 'cjs';
const ext = format.startsWith('esm') ? 'mjs' : 'js';
const load = async path => {
    const filename = resolve('dist', format, path + '.' + ext);
    return ext === 'mjs' ? import(pathToFileURL(filename).href) : require(filename);
};
const {Carburetor, computed, transaction} = await load('Carburetor/index');
const {computedDependencies} = await load('Carburetor/Derived/computedDependencies');
const {C} = await load('Carburetor/Derived/Models');
console.log(JSON.stringify({probe: 'identity', format, node: process.version,
    react: require('react').version, dist: realpathSync('./dist')}));

function merge(shape, field, observed, reverse = false) {
    const store = new Carburetor({a: 1, b: 2, c: 3, d: 4, noise: 0});
    const runs = Array(7).fill(0);
    const leaves = ['a', 'b', 'c', 'd'].map((key, i) => computed(read => {
        runs[i]++;
        return read(store)[key];
    }));
    const left = computed(read => { runs[4]++; return read(leaves[0]) + read(leaves[1]); });
    const right = computed(read => { runs[5]++; return read(leaves[2]) + read(leaves[3]); });
    const total = computed(read => {
        runs[6]++;
        if (shape === 'flat') return leaves.reduce((sum, leaf) => sum + read(leaf), 0);
        if (shape === 'merged-plus-bare') return read(left) + read(leaves[2]) + read(leaves[3]);
        return reverse ? read(right) + read(left) : read(left) + read(right);
    });
    const deliveries = [];
    const id = observed ? total.subscribe(() => deliveries.push(total.get())) : undefined;
    const initial = total.get();
    const initialParts = Object.values(computedDependencies.versions.get(total)())[0].parts
        ?.map(part => Array.from(part.reads).join(','));
    let during;
    const change = () => { store.update(draft => { draft[field] += 10; }); during = total.get(); };
    if (observed) transaction(change); else change();
    const after = total.get();
    if (id !== undefined) total.unsubscribe(id);
    return {shape, field, observed, reverse, initial, expected: field === 'noise' ? 10 : 20,
        initialParts, during, after, deliveries, runs};
}
console.log(JSON.stringify({probe: 'merge', format, cases: [
    merge('merged-plus-merged', 'a', false), merge('merged-plus-merged', 'c', false),
    merge('merged-plus-merged', 'a', false, true), merge('flat', 'a', false),
    merge('merged-plus-bare', 'a', false), merge('merged-plus-merged', 'noise', false),
    merge('merged-plus-merged', 'a', true),
]}));

const originalIterator = Array.prototype[Symbol.iterator];
let partRefs = 0;
function countedIterator() {
    const iterator = originalIterator.call(this);
    const partArray = this.length > 0 && this[0] !== null && typeof this[0] === 'object'
        && this[0].reads instanceof Set && typeof this[0].version === 'number'
        && !Object.hasOwn(this[0], 'source');
    if (!partArray) return iterator;
    return {
        next(...args) { const item = iterator.next(...args); if (!item.done) partRefs++; return item; },
        [Symbol.iterator]() { return this; },
    };
}
function countParts(body) {
    partRefs = 0;
    Array.prototype[Symbol.iterator] = countedIterator;
    try { body(); } finally { Array.prototype[Symbol.iterator] = originalIterator; }
    return partRefs;
}
function fanin(K, shared) {
    const sources = shared
        ? [new Carburetor(Object.fromEntries(Array.from({length: K}, (_, i) => ['p' + i, i])))]
        : Array.from({length: K}, (_, i) => new Carburetor({p: i}));
    const inputs = Array.from({length: K}, (_, i) =>
        computed(read => read(sources[shared ? 0 : i])[shared ? 'p' + i : 'p']));
    let runs = 0, deliveries = 0;
    const total = computed(read => {
        runs++;
        let sum = 0;
        for (const input of inputs) sum += read(input);
        return sum;
    });
    const id = total.subscribe(() => deliveries++);
    const initial = total.get();
    const oldParts = Object.values(computedDependencies.versions.get(total)())[0].parts;
    const copiedRefs = countParts(() => sources[0].update(draft => { draft[shared ? 'p0' : 'p']++; }));
    const current = total.get();
    const finalParts = Object.values(computedDependencies.versions.get(total)())[0].parts?.length ?? 0;
    total.unsubscribe(id);
    return {K, shared, initial, current, runs, deliveries, copiedRefs, finalParts,
        oldPartsUnchanged: oldParts === undefined || oldParts.length === K};
}
const positiveParts = [{version: 0, reads: new Set(['control'])}, {version: 0, reads: new Set(['positive'])}];
console.log(JSON.stringify({probe: 'fanin', format, emptyControl: countParts(() => 0),
    positiveControl: countParts(() => { [...positiveParts]; }),
    cases: [fanin(8, true), fanin(16, true), fanin(32, true), fanin(32, false)]}));

const label = value => value === undefined ? 'undefined' : value === null ? 'null' : String(value);
function equality(start, observed) {
    const store = new Carburetor({present: start});
    const comparisons = [], seen = [];
    const value = computed(read => read(store).present ? null : undefined, {
        equals: (before, after) => {
            comparisons.push([label(before), label(after)]);
            return before == null && after == null;
        },
    });
    const id = observed ? value.subscribe(() => seen.push(label(value.get()))) : undefined;
    const initial = label(value.get());
    const initialComparisons = comparisons.length;
    store.update(draft => { draft.present = !draft.present; });
    const current = label(value.get());
    const version = value.getVersion();
    if (id !== undefined) value.unsubscribe(id);
    return {start, observed, initial, initialComparisons, current, version, comparisons, seen};
}
console.log(JSON.stringify({probe: 'equals', format,
    cases: [equality(false, true), equality(true, true), equality(false, false), equality(true, false)]}));

function nativeControl() {
    const store = new Carburetor({n: 1, noise: 0});
    let attaches = 0, releases = 0;
    const subscribe = store.subscribe.bind(store), unsubscribe = store.unsubscribe.bind(store);
    store.subscribe = (...args) => { attaches++; return subscribe(...args); };
    store.unsubscribe = (...args) => { releases++; return unsubscribe(...args); };
    const runs = [0, 0, 0], seen = [];
    const first = computed(read => { runs[0]++; return read(store).n; });
    const second = computed(read => { runs[1]++; return read(first) * 2; });
    const total = computed(read => { runs[2]++; return read(first) + read(second); });
    const id = total.subscribe(() => seen.push(total.get()));
    const initial = total.get(), warmed = runs.slice();
    for (let i = 0; i < 8; i++) total.get();
    store.update(draft => { draft.noise++; });
    total.get();
    const quietDeltas = runs.map((count, i) => count - warmed[i]);
    const beforeAttach = attaches, beforeRelease = releases;
    let during, duringDeliveries;
    transaction(() => {
        store.update(draft => { draft.n = 2; });
        during = total.get();
        duringDeliveries = seen.length;
    });
    const changedDeltas = runs.map((count, i) => count - warmed[i]);
    const retainedAttach = attaches - beforeAttach, retainedRelease = releases - beforeRelease;
    total.unsubscribe(id);
    const released = {announcedCleared: first[C.announced] === undefined,
        activeReadSlots: first[C.activeReads].size,
        cachedLeafCount: Object.keys(computedDependencies.versions.get(first)()).length};
    const rejoin = total.subscribe(() => seen.push(total.get()));
    store.update(draft => { draft.n = 3; });
    const final = total.get();
    total.unsubscribe(rejoin);
    return {initial, quietDeltas, during, duringDeliveries, changedDeltas, retainedAttach, retainedRelease,
        released, final, seen, attaches, releases};
}
function externalControl() {
    let versionCalls = 0, attaches = 0, releases = 0;
    const source = {value: 1, version: 0, listeners: new Map(),
        getUID: () => '__proto__',
        getVersion() { versionCalls++; return this.version; },
        get() { return this.value; },
        subscribe(callback, options) { attaches++; this.listeners.set(options.id, callback); return options.id; },
        unsubscribe(id) { releases++; this.listeners.delete(id); },
        set(value, emit = true) {
            this.value = value; this.version++;
            if (emit) for (const callback of Array.from(this.listeners.values())) callback();
        },
    };
    const first = computed(read => read(source));
    const second = computed(read => read(source) * 2);
    const total = computed(read => read(first) + read(second));
    const seen = [], id = total.subscribe(() => seen.push(total.get()));
    const initial = total.get(), upstreamListeners = source.listeners.size;
    versionCalls = 0;
    for (let i = 0; i < 8; i++) total.get();
    const stableVersionCalls = versionCalls;
    source.set(2);
    source.set(3, false);
    const silentPull = total.get();
    source.set(4);
    const final = total.get();
    total.unsubscribe(id);
    return {initial, upstreamListeners, stableVersionCalls, silentPull, final, seen,
        attaches, releases, remainingListeners: source.listeners.size};
}
function retiredRouteControl() {
    const flag = new Carburetor({tick: 0});
    const old = new Carburetor({left: 1, right: 2});
    const next = new Carburetor({left: 10, right: 20});
    old.getUID = next.getUID = () => 'r42-reused';
    let selected = old, retained, runs = 0;
    const value = computed(read => {
        runs++;
        void read(flag).tick;
        const view = read(selected);
        if (selected === old) retained = view;
        return view.left;
    });
    const seen = [], id = value.subscribe(() => seen.push(value.get()));
    selected = next;
    flag.update(draft => { draft.tick++; });
    const before = runs;
    void retained.right;
    old.update(draft => { draft.right++; });
    next.update(draft => { draft.right++; });
    value.get();
    const unreadDeltas = runs - before;
    next.update(draft => { draft.left = 11; });
    const final = value.get();
    value.unsubscribe(id);
    return {unreadDeltas, final, retainedLeft: retained.left, seen,
        announcedCleared: value[C.announced] === undefined, activeReadSlots: value[C.activeReads].size};
}
console.log(JSON.stringify({probe: 'controls', format, native: nativeControl(),
    external: externalControl(), retiredRoute: retiredRouteControl()}));

```

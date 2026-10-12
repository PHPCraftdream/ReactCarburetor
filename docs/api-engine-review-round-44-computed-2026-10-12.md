# API / engine review — раунд 44: Computed, checkpoints и fan-in

Дата: **2026-10-12**. Reviewed base: **`acfd3e2b8e58210ce1076bf1683f666283216af5`**. Исполнитель: **xxs / R44Computed**.

Scope: `lib/src/Carburetor/Derived/**`, включая `Computed.ts`, `computedDependencies.ts`, `renderOwner.ts` и Freshness helpers; Derived-facing public models, `TodoViews`, hook consumer, dependency/lifecycle/freshness coverage и computed/derived/computed41/computed42/computed43 benchmark families. Это **review-only**: изменён только назначенный Markdown-отчёт. Production, tests, configs, dependencies, версии, lock и Git не записывались; commit/push не выполнялись.

## Результат

| ID | Приоритет | Подтверждённый механизм | Evidence |
|---|---|---|---|
| **R44-C01** | **P2, performance / scaling** | K cached native aliases несут K отдельных flattened dictionaries с одними и теми же M leaf records. Один top-only refresh повторно перечисляет все K·M entries и вызывает leaf `getUID()` K·M раз, хотя результат содержит M+1 leaves | Source + bounded public-API probes на четырёх formats; K8/M8 = 64, K16/M16 = 256 entries/UID calls. Это не повтор R43-C02: `parts` вообще отсутствуют |
| **R44-C02** | **P3, avoidable hot-path work** | Уже observed stale recompute перечисляет прежние leaf keys ради `hadValue`, хотя следующий `wasUnobserved && hadValue` не использует результат | Source + отдельно от capture измеренный pre-body `Object.keys`: 1 вызов, M entries при M=1/8/32; unchanged scalar result имеет ту же стоимость |

Новых correctness/lifetime/render findings в этой теме не подтверждено. Рекомендации не означают реализованного выигрыша. **Не измерялись и не заявляются** heap bytes, allocation rate, latency, CPU instructions, retained bytes или React render savings. Счётчики ниже — calls/entries реального synchronous operation, не байты и не время.

Перед исследованием прочитаны [R43 Computed report](api-engine-review-round-43-computed-2026-10-11.md) и [R43 overview, Resolution:75–109](api-engine-review-round-43-2026-10-11.md#resolution-реализация-r43). R43-C01/C02/C03 уже исправлены. Также сопоставлены R42 Computed findings/exclusions и реализованные R41 границы, указанные parent. Symbol isolation, last-observer cleanup, O(D) dependency membership, memo-child proxy reuse, lossless capture/linear builder, undefined-aware equality и React18 fixture repairs здесь не переобъявляются.

## База исполнения и доступность инструментов

- Единственный Git command — read-only `git rev-parse HEAD`; stdout: `acfd3e2b8e58210ce1076bf1683f666283216af5`, exit 0. Git writes не было.
- Parent предоставил immutable current distribution `worktrees/bench-dist/acfd3e2b8e58/{esm,esm-prod,cjs,cjs-prod}`. Прочитан его receipt `.rush/stdin/r44-base-build.json`: primary build выполнен после final R43 Set cleanup; данный SHA менял test/benchmark diagnostics, не `lib/src`. Это **provenance parent**, не собственная сборка или независимая верификация всех bundle bytes.
- Пробы исполняли **только этот frozen distribution**, не старые `90a1c...`/`fa1ad...` и не mutable root `dist`. Root `dist/esm` был прочитан при первоначальном source mapping, но не использован для runtime evidence.
- `xd://lsp` ответил: `No such tool: xd://lsp. Mounted devices: ast_edit, debug.` Definitions/references установлены grep/read; LSP results не выдумываются.
- Build/lint/test suites/formatters, общий perf runner, Chromium, GC/heap probes, UAC, traces и нагрузочные/parallel jobs **не запускались**. Выполнены ровно две lightweight recipes ниже, каждая serially в четырёх отдельных Node processes; Node **v24.12.0**. У всех восьми children exit 0 и пустой stderr.

Entry SHA256, записанные parent в receipt:

| Format | Entry suffix | SHA256 |
|---|---|---|
| esm | `Carburetor/index.mjs` | `c6b398aef0894b0122d9416c19817922e1477a31eed32e7c1a966eff3acb3685` |
| esm-prod | `Carburetor/index.mjs` | `a21d29ea69b7a6f9f6da09b785fda2e5e1798fa4767caa473971baaf562104da` |
| cjs | `Carburetor/index.js` | `12a218820879a2ac7038a2412ced25cf2aa821d4019a540eb8551ed9148c9186` |
| cjs-prod | `Carburetor/index.js` | `9154e2f4fb55984af9f2efc8c9bf5efe58a2b931e6a5c8979a294e00d1c86447` |

## R44-C01 — повторное flattening одних leaf records через отдельные alias dictionaries

### Public consumer scenario и source anchors

Dashboard агрегирует **M отдельных native stores** в scalar `group`. K независимо используемых derived projections читают `group` и преобразуют число; общий summary читает эти projections плюс собственный tick/extra store. `group` наблюдается самостоятельно, а top subscription удерживает alias edges. Обновление только tick заставляет перечитать top, но group и aliases остаются cached.

```text
store0.n ... store(M-1).n ──> group = sum(read(store).n), отдельно observed
                              ├─> alias0 = read(group) + 0 ─┐
                              ├─> alias1 = read(group) + 1 ─┤
                              └─> ... alias(K-1)           ─┤
             tick.n ───────────────────────────────────────> top = tick + sum(read(alias))
```

Это обычные `computed(body)`/`read(computed)`/`subscribe`, без внешней injection metadata или private-state mutation. Описанная dashboard топология — reachable пример, а не утверждение, что ToDo demo уже имеет K×M граф. Реальная composition convention присутствует в [`TodoViews.ts:27–30,68–69`](../lib/src/ToDo/Derived/TodoViews.ts#L27) и [`README.md:410–416`](../README.md#L410); публичный whole-value reader определён в [`Models/Derived.ts:9–19`](../lib/src/Carburetor/Models/Derived.ts#L9).

Точная цепочка:

1. [`Computed.ts:425–431`, `C.recordVersions`](../lib/src/Carburetor/Derived/Computed.ts#L425) всегда создаёт новый `versions = {}`. Даже alias с единственным native computed input не заимствует целый snapshot; заимствуются только leaf records.
2. [`captureLeafVersions.ts:88–91,104–109`](../lib/src/Carburetor/Derived/Freshness/captureLeafVersions.ts#L88) получает `inner` каждого direct computed dependency и перечисляет `Object.keys(inner)`. Для каждого элемента вызываются `recorded.source.getUID()`, добавление encoded id и native classification.
3. [`captureLeafVersions.ts:26–28`](../lib/src/Carburetor/Derived/Freshness/captureLeafVersions.ts#L26) уже умеет `previous === recorded`. Но этот fast path стоит **после** outer dictionary traversal и `getUID()`. Он предотвращает повторную запись/merge одинакового leaf, а не повторное перечисление dictionary.
4. [`Computed.ts:128`](../lib/src/Carburetor/Derived/Computed.ts#L128) регистрирует getter **текущего** snapshot в shared native metadata registry; [`computedDependencies.ts:24–28`](../lib/src/Carburetor/Derived/computedDependencies.ts#L24) делает registry cross-copy. Alias dictionary identities разные, хотя каждого native leaf record identity ровно одна на весь K-alias input set.

### Наблюдаемая стоимость, positive/cheap controls и O

Измерено в synchronous окне **реального `tick.update(...) + top.get()`**, после завершения graph setup. `Object.keys` считается только на exact alias input dictionaries, а `getUID` — только на M leaf sources. Все alias dictionaries были уже captured до окна. Обёртки вызывают оригинальные методы и восстанавливаются в `finally`; `getVersion`/publication methods не меняются, native eligibility не обходится.

Во всех четырёх formats получены одинаковые строки:

| K | M | Layout | Input dictionaries | Input key calls | Input entries | Leaf UID calls | Top leaves после tick | Values initial → tick → leaf write |
|---:|---:|---|---:|---:|---:|---:|---:|---|
| 1 | 8 | aliases | 1 | 1 | 8 | 8 | 9 | 36 → 37 → 38 |
| 8 | 1 | aliases | 8 | 8 | 8 | 8 | 2 | 36 → 37 → 45 |
| 4 | 4 | aliases | 4 | 4 | 16 | 16 | 5 | 46 → 47 → 51 |
| 8 | 8 | aliases | 8 | 8 | **64** | **64** | 9 | 316 → 317 → 325 |
| 16 | 16 | aliases | 16 | 16 | **256** | **256** | 17 | 2296 → 2297 → 2313 |
| 8 | 8 | direct repeated `read(group)` control | 1 | 1 | **8** | **8** | 9 | 316 → 317 → 325 |

- Empty и 16 cached `top.get()` дают 0/0/0. Механизм не попадает на stable all-native epoch shortcut.
- Positive counter control перечисляет каждый выбранный input snapshot один раз и спрашивает UID каждого source один раз: `keyCalls = inputs`, `keyEntries = inputs·M`, `uidCalls = M`. Это отдельно проверяет чувствительность обоих счётчиков.
- В tick window top body выполняется один раз, group/alias bodies — **0 дополнительных раз**, и приходит ровно одна top callback. Следовательно K·M visits не являются body evaluation K aliases.
- Leaf records одинаковы по identity между всеми inputs, все имеют `reads`, у всех `parts === undefined`; top удерживает ровно M+1 leaf records. Это **не** R43-C02 borrowed merged-parts scan, не прежнее copying accumulated prefix, не reads-identity collision и не dependency membership O(D²).
- После tick current group/alias snapshot identities остаются прежними. Unrelated `noise` write не запускает bodies, а related `store0.n++` даёт корректный top `initial + 1 + K` и вторую callback. Полная immutability всех полей old snapshots после related write отдельно этим рецептом не измеряется; stdout `snapshotsIntact` обозначает проверенные identities/coverage в tick window, не heap/GC доказательство.
- Direct control выполняет K публичных reads и те же арифметические projections, но dependency dictionary содержит только `group`. Он показывает влияние metadata topology; это не совет удалить independently consumed aliases или заменить пользовательскую модель одним total.

**[INFERENCE, source-backed]** Capture данного top refresh имеет Θ(K·M) leaf-entry enumeration, UID/native-classification work при K direct aliases и M+1 output leaves; при K=M — квадратичный член. Числа выше подтверждают конкретные bounded points, но не являются временем или доказательством математической scaling curve всей операции. В общем графе с K действительно различными M-leaf snapshots Θ(K·M) может быть необходимым: finding ограничен повторением **одних и тех же** leaf records через alias-only snapshots.

### Консервативное направление и риски

Сначала рассмотреть **snapshot-level reuse для exact single native-computed input**: alias после успешного evaluation может удерживать неизменяемый upstream snapshot, захваченный в этот момент, вместо отдельного shallow dictionary с теми же leaves. На стороне multi-input capture учёт уже полностью обработанного exact snapshot позволит перечислить такой shared dictionary один раз. Это внутренний путь, без нового `computedAlias`/selector public API.

**[INFERENCE]** При обоих шагах повторяющийся capture-member может стать O(K+M), а alias-only metadata wrappers — перестать дублироваться. Это направление, не испробованная реализация и не обещанный whole-operation speedup. Если использовать лишь capture-local identity dedup отдельных leaf records, можно пропустить повторные UID/classification действия, но **нельзя** объявлять dictionary enumeration линейным: он всё ещё Θ(K·M).

Обязательные ограничения:

- Заимствуется **конкретный immutable snapshot**, не live getter «всегда отдавать latest upstream versions»: alias result обязан проверяться против checkpoint именно его evaluation. Иначе возможен fresh stamp на старом result.
- Не мутировать заимствованный dictionary/leaf/parts. Current production writes к `C.versions` — replacement/rollback в `recordVersions`, `attachDependencies` и `announceIsUnchanged.accept`, а не in-place editing принятого snapshot ([`Computed.ts:333–380,426–431`](../lib/src/Carburetor/Derived/Computed.ts#L333), [`announceIsUnchanged.ts:103–116`](../lib/src/Carburetor/Derived/Freshness/announceIsUnchanged.ts#L103)). Это основание исследовать reuse, не универсальный proof для внешнего producer.
- Registry сейчас содержит только getter dictionary; blanket forwarding любого registered metadata небезопасен. Foreign metadata test использует произвольный `store.getUID()` key ([`DependencyMaintenance.test.ts:140–152`](../__tests__/Engine/Derived/Computed/DependencyMaintenance.test.ts#L140)); capture нормализует encoded keys через source identity. Внешние/mixed producers без доказанных immutable/encoded-key invariants обязаны сохранять существующий lossless path.
- Native classification **проверяет identity** `getVersion`/`emitUpdate` ([`isNativeStoreSource.ts:8–12`](../lib/src/Carburetor/Store/Scheduling/isNativeStoreSource.ts#L8)). Snapshot reuse не даёт права слепо доверять старому `allNative` при protocol-changing adapter; external silent public version остаётся freshness source.
- Новые capture-local identity tables должны быть lazy, не добавлять unconditional Set/Map на empty/K1/no-collision routes и не удерживать obsolete sources между evaluations. Есть tradeoff bookkeeping, он не бесплатный.
- Сохранять successful baseline/candidate checkpoints, comparator rollback/reentrant safety R43-C01; observer announcement остаётся отдельным checkpoint. Не заменять equality policy сравнением metadata identity.

Consumer/reference analysis: `computedDependencies.versions.set` в production найден в constructor `Computed.ts:128`; lookup — `captureLeafVersions.ts:91`. Остальные state reads/replacements — freshness/acceptance/announcement перечисленные выше; unit fixtures отдельно регистрируют foreign metadata. Current public `IComputed`, `TComputedReader`, factory и hook consumer остаются прежними. Registry shared across library copies означает обязательные mixed-format controls, даже если public signature не меняется. Ссылки в tests на private dictionary identity — диагностика, не user API; нельзя превратить K разных wrapper identities в обязательный permanent gate.

### Предлагаемый benchmark acceptance

Предложить `computed44/repeated-flat-snapshot` с независимыми K=1/4/16 и M=1/4/16, **отдельными native stores**, warmed observed upstream и top-only tick. Это дополнение, не переименование `computed43/repeated-borrowed-group`.

- Target: количество реально просмотренных input leaf entries/UID calls у повторного snapshot близко к M, не K·M; обязательный accounting K input edges отдельно. Если достигается лишь leaf-identity skip, принимать только реально уменьшенные UID/classification calls, не заявлять O(K+M) traversal.
- Semantic gates: checksums `initial`, `+1`, `+1+K`; tick body once/upstream quiet; exact callbacks/public versions; full leaf coverage; old/upstream snapshot contents untouched; unrelated paths quiet; related и branch-migration writes точны.
- Controls: empty/stable cached reads; K1; direct repeated reads; **distinct** snapshot/record identities, overlapping but не identical leaf pairs, same Set captured at разных versions, external silent-version source, changed producer protocol, observed/unobserved, eager transaction and cross-format graph.
- Отдельный parent-run uninstrumented `update+get` A/B после корректного prototype; никакого timing под monkeypatch. Сохранить старые computed42 part-work/timing/lossless/undefined, computed43 repeated-borrowed and acceptance/cheap-controls, computed41 lifecycle/dependencies, derived R32/R34 и diamond-ladder gates.
- Baseline recipe ниже намеренно assert-ит сегодняшний K·M механизм и разные wrapper identities. Для future gain gate заменить **только диагностические current-cost/current-shape assertions** на целевой bound; не удалить checksum/control/coverage checks.

## R44-C02 — baseline eligibility scan до проверяемого `wasUnobserved`

### Reachable операция и source

Mounted hook/class, `subscribe`-consumer или downstream native computed уже наблюдает scalar derived над M leaves. Реальная relevant write invalidates evaluation cache; wave settlement запускает body. На этом route unobserved acceptance отсутствует, но recompute сначала полностью перечисляет прежние leaf keys:

```ts
const hadValue = this[C.valid] || Object.keys(this[C.versions]).length > 0;
const acceptance = this as unknown as Parameters<typeof announceIsUnchanged.capture<R>>[0];
const baseline = wasUnobserved && hadValue ? announceIsUnchanged.capture(acceptance) : undefined;
```

Точный anchor: [`Computed.ts:236,273–275`, `C.recompute`](../lib/src/Carburetor/Derived/Computed.ts#L236). [`C.markStale:502–507`](../lib/src/Carburetor/Derived/Computed.ts#L502) уже выставил `valid=false`, поэтому первое `||` не short-circuit-ит. [`C.settle:531–533`](../lib/src/Carburetor/Derived/Computed.ts#L531) вызывает recompute с default `wasUnobserved=false`, когда subscribers есть. Вся key array создана только для неиспользуемого `hadValue`.

Здесь речь не о двух необходимых atomic acceptance objects на changed **unobserved** recompute (`announceIsUnchanged.capture/accept`), явно отмеченных в R43 Resolution. Это **observed** route, где `baseline` всё равно `undefined` и capture вообще не вызывается. Rollback/reentrant safety не предлагается убирать.

Public route реально используется [`TodoViews.ts:28–30,56–69`](../lib/src/ToDo/Derived/TodoViews.ts#L28); hook читает value и snapshot token, затем подписывается ([`useComputedValue.ts:15–29,38–50`](../lib/src/Interop/useComputedValue.ts#L15)). Проба использует `subscribe` напрямую, без React исполнения; никаких render savings из этого не выводится.

### Наблюдаемая стоимость и controls

Отдельная instrumentation boundary — **между entry в `C.recompute` и entry в body**, только `Object.keys` на exact предыдущем `C.versions`. Это исключает нужные scans `driftedSince`, dependency attachment и leaf capture после body. Method seam найден через existing `engineKey` convention; метод вызывается с тем же receiver/args и после пробы own override удаляется.

Во всех четырёх formats:

| M | Уже observed changed scalar | Уже observed same scalar | After last release, unobserved refresh | Valid unobserved refresh | Empty/cached window |
|---:|---|---|---|---|---|
| 1 | 1 call / 1 entry | 1 / 1 | 1 / 1 | 0 / 0 | 0 / 0 |
| 8 | 1 / 8 | 1 / 8 | 1 / 8 | 0 / 0 | 0 / 0 |
| 32 | 1 / 32 | 1 / 32 | 1 / 32 | 0 / 0 | 0 / 0 |

Cold first subscribe: 1 call / 0 entries. Positive control явным pre-body scan известного snapshot даёт 1/M. Observed relevant write вызывает body один раз; changed scalar доставляется один раз, constant scalar `1` — ноль callbacks. В recipe `equal=true` обозначает **same scalar body result**, не пользовательский comparator. После last release unobserved values и snapshot revisions корректно обновляются; этот полезный route не предлагается удалять.

**[INFERENCE, source-backed]** Лишний member — O(M) перечисление/построение key array на каждом invalidated observed recompute, независимо от changed/equal результата. Во всём graph добавляется сумма прежних leaf-count по recomputed nodes. Это не claim об изменении общего O(M) flat-derived evaluation: body/recordVersions всё равно могут законно делать O(M). `Object.keys` call/array entries — измеренная mechanism metric; heap allocation size и время не измерялись.

### Консервативное направление и acceptance

Проверять **parameter `wasUnobserved` до** вычисления baseline eligibility, оставляя нынешний `hadValue` criterion и `capture` только внутри нужного route. Не заменять его текущим `subscribers.size === 0`: первый subscribe вызывает `recompute(wasUnobserved)` с **true**, хотя регистрацию уже добавил ([`Computed.ts:163–179`](../lib/src/Carburetor/Derived/Computed.ts#L163)). В render→subscribe gap может требоваться принятие прежней unobserved baseline. Сохранить captured original value/version/epoch, candidate checkpoint, failure invalidation/rollback и reentrant self-read acceptance целиком.

Предложить `computed44/observed-baseline-eligibility`:

- Gain gate: 0 прежних-version key scans **до body** на уже observed changed/equal relevant writes, M=1/8/32; семантика body/delivery/version/token неизменна.
- Positive boundary control остаётся 1/M; cold, cached/empty, valid unobserved и after-release lanes сохраняют прежнюю семантику. Никакого запрета unobserved baseline keys или comparator calls.
- Обязательны existing R43 equality-failure acceptance/reentrant source-write controls, undefined baseline, first subscribe after intervening write, transaction/throttle eager reads, equal checkpoint ownership и last-release/rejoin. Нынешний recipe — baseline diagnosis, не готовый post-fix target gate.
- Проверить uninstrumented operation serially parent после implementation, включая cheap constant-tick и empty computed controls. Speedup заранее не назначать; не вводить public option/другой equality API ради одного short-circuit.

## Не finding: обязательная ownership/freshness работа и исключённые кандидаты

| Кандидат / механизм | Решение и точные границы |
|---|---|
| Два unobserved acceptance checkpoints | [`announceIsUnchanged.ts:78–116`](../lib/src/Carburetor/Derived/Freshness/announceIsUnchanged.ts#L78) сохраняет baseline **до** body, candidate **до** comparator; reentrant comparator может replace state, throw или написать source. [`R43EqualityFailureAcceptance.test.ts:149–258`](../__tests__/Engine/Derived/computed43/R43EqualityFailureAcceptance.test.ts#L149) pin-ит это. Слепое удаление candidate/возврат rejected value — нарушение R43, не optimization. Нужного distinct безопасного allocation win здесь не доказано |
| Borrowed `parts` scan / quadratic accumulated-prefix copying | Current [`captureLeafVersions.ts:48–81`](../lib/src/Carburetor/Derived/Freshness/captureLeafVersions.ts#L48) имеет capture-owned builder и exact `firstMerged`/`merged` bookkeeping. R43-C02 и R42-C02 не повторяются; C01 выше работает на `parts===undefined` |
| Потеря merged groups / captured version dedup | Constituent reads identity **и version** сохранены (`captureLeafVersions.ts:35–46`); tests [`R42LeafCapture.test.ts:142–157`](../__tests__/Engine/Derived/computed42/R42LeafCapture.test.ts#L142) требуют не схлопывать один Set разных versions. Не предлагается объединять по path text/UID/текущей версии |
| Повторная native freshness validation после unrelated global write | [`Computed.ts:219–232`](../lib/src/Carburetor/Derived/Computed.ts#L219) уже имеет stable epoch O(1) shortcut. [`leafVersionsDrifted.ts:12–33,42–59`](../lib/src/Carburetor/Derived/Freshness/leafVersionsDrifted.ts#L12) делает filed per-pair checks и проверяет replaced data для live results. Epoch меняется до deferred delivery; unobserved/external sources требуют реального version check. Blanket «не проверять пока observed» ломает eager freshness |
| Direct read sets / dependency setup | [`Computed.ts:322–423`](../lib/src/Carburetor/Derived/Computed.ts#L322) сохраняет retained filed reads identity, использует direct fresh flags, setup transaction и rollback. Ноль subscription churn на retained edges уже покрыт [`DependencyMaintenance.test.ts:37–55`](../__tests__/Engine/Derived/Computed/DependencyMaintenance.test.ts#L37). Distinct attachment failure/reentrant safety regression не обнаружена чтением; suites не запускались |
| Recorder allocation на PersistentViews cache hit | Current [`Computed.ts:251–264,294–299`](../lib/src/Carburetor/Derived/Computed.ts#L251) действительно передаёт factory result до [`PersistentViewCache.ts:37–40`](../lib/src/Carburetor/Store/Tracking/Observation/PersistentViewCache.ts#L37). Это уже rejected R42/R43 candidate. В этом раунде его реальный throughput/heap effect отдельно не измерен; не добавлен ради количества findings и не предлагается возвращать factory внутрь evaluation lexical scope |
| Equal announcement ownership | [`Computed.ts:542–545`](../lib/src/Carburetor/Derived/Computed.ts#L542) продвигает settled dependency checkpoint без публикации; last release закрывает announcement/strong routes до external teardown (`:435–455`). R43-C03/R41-02 не повторяются. Retained evaluation value/versions и caller-held old snapshots — intentional ownership, не blanket leak. GC не запускался |
| Observer waves / markStale / delivery snapshots | Validity monotone mark (`Computed.ts:502–515`), queued observation generation (`:486–491`), settlement generation check (`:541`), per-registration generation (`:554–574`) и external bridge wave ([`computedDependencies.ts:51–64`](../lib/src/Carburetor/Derived/computedDependencies.ts#L51)) нужны для reentrant leave/rejoin и settled fan-in. [`UpdateWave.ts:48–68`](../lib/src/Carburetor/Store/Scheduling/UpdateWave.ts#L48) изолирует failures и drains cascades. Убирать snapshots/guards ради counts не предложено; новый excess body-wave механизм не подтверждён |
| `renderOwner` и escape diagnostic | [`renderOwner.ts:8–11,13–34`](../lib/src/Carburetor/Derived/renderOwner.ts#L8), [`Foundation.tsx:277–302`](../lib/src/Carburetor/Component/AntiHookComponent/Foundation.tsx#L277) и [`reportComputedEscape.ts:27–44`](../lib/src/Carburetor/Derived/reportComputedEscape.ts#L27) — development-only owner/diagnostic с restoration в finally, не production invalidation. Нет основания менять precision или suppress warning как performance fix |
| Новый public alias/dispose/retry/selector knob | Current `IComputed`/factory/read composition достаточны для наблюдённого cost. Новый public cutover не предлагается, соответственно compatibility shim plan отсутствует. API-driven metadata cost исправлять внутри engine, не переносить обязанности freshness/rollback на consumer |

### Что существующие benchmark families различают, а что пропускают

- `computed/pulls` защищает stable/unobserved body counts и one-notification fan-in; его fan-in inputs имеют один leaf store (`pulls.mjs:34–46`). `computed/freshness` имеет D direct stores, но нет независимо scaled K alias wrappers поверх M leaves (`freshness.mjs:38–44`). Эти программы не доказывают отсутствие C01/C02.
- `computed41/dependencies` считает direct edge work/retained attaches и старый includes search (`dependencies.mjs:23–58`); он не измеряет flattened leaf keys **до body**. R41 O(D²) membership исправлен.
- `computed42/fan-in-part-work`, `fan-in-timing` и `R42LeafCapture` защищают distinct bare/merged pairs, accumulated prefix, snapshots и freshness. Их сильные semantic controls нужны новому snapshot reuse, но metric pair-appends не видит repeated dictionaries над отдельными stores.
- `computed43/graph.mjs:25–45` строит M **per-field computeds одного store**, то есть один merged record с M parts; [`repeated-borrowed-group.mjs:16–30`](../perf/scenarios/computed43/repeated-borrowed-group.mjs#L16) считает Map.get по common reads identities. C01: M **stores**, M bare records и Object.keys/UID work; механизмы ортогональны.
- [`computed43/cheap-controls.mjs:14–54`](../perf/scenarios/computed43/cheap-controls.mjs#L14) считает только Map/Set constructors, не plain `Object.keys` arrays; stable cache и equal-tick controls полезны, но не ловят C02. Эти constructor counts сами по себе никогда не объявляются bytes.
- Derived R32 (`r32-fan-in.mjs:16–40`) и R34 (`drift-fan-in.mjs:16–39`) имеют genuine completed operations; их Set/WriteLog metrics не заменяют два новых счётчика. Suites/permanent scenarios здесь только читались.

## Точные исполненные commands и полный source recipes

Восемь subprocess commands ниже реально исполнялись с `cwd=D:/dev/ReactCarburetor`, `text=True`, `capture_output=True`, `timeout=30`; **stdin = полный соответствующий JavaScript source**. Сначала все четыре C01 children, затем все четыре C02, без parallelism. Дополнительных probe files на диске агент не создавал.

```text
# stdin: R44-C01-PROBE
node --input-type=module - D:/dev/ReactCarburetor/worktrees/bench-dist/acfd3e2b8e58/esm esm
node --input-type=module - D:/dev/ReactCarburetor/worktrees/bench-dist/acfd3e2b8e58/esm-prod esm-prod
node --input-type=module - D:/dev/ReactCarburetor/worktrees/bench-dist/acfd3e2b8e58/cjs cjs
node --input-type=module - D:/dev/ReactCarburetor/worktrees/bench-dist/acfd3e2b8e58/cjs-prod cjs-prod
# stdin: R44-C02-PROBE
node --input-type=module - D:/dev/ReactCarburetor/worktrees/bench-dist/acfd3e2b8e58/esm esm
node --input-type=module - D:/dev/ReactCarburetor/worktrees/bench-dist/acfd3e2b8e58/esm-prod esm-prod
node --input-type=module - D:/dev/ReactCarburetor/worktrees/bench-dist/acfd3e2b8e58/cjs cjs
node --input-type=module - D:/dev/ReactCarburetor/worktrees/bench-dist/acfd3e2b8e58/cjs-prod cjs-prod
```

### Recipe R44-C01

<!-- R44-C01-PROBE -->
```js
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {engine, engineKey} from './perf/harness/lib.mjs';
const root = resolve(process.argv[2]);
const format = process.argv[3];
const entry = resolve(root, 'Carburetor', format.startsWith('cjs') ? 'index.js' : 'index.mjs');
const api = format.startsWith('cjs') ? createRequire(import.meta.url)(entry)
    : await import(pathToFileURL(entry).href);
const {Carburetor, computed} = api;

function run(K, M, mode = 'aliases') {
    const sources = Array.from({length: M}, (_, i) => new Carburetor({n: i + 1, noise: 0}));
    const tick = new Carburetor({n: 0});
    let groupRuns = 0, topRuns = 0;
    const aliasRuns = Array(K).fill(0);
    const group = computed(read => {
        groupRuns++;
        return sources.reduce((sum, source) => sum + read(source).n, 0);
    });
    const groupId = group.subscribe(() => {});
    const aliases = mode === 'aliases' ? Array.from({length: K}, (_, i) => computed(read => {
        aliasRuns[i]++;
        return read(group) + i;
    })) : [];
    const top = computed(read => {
        topRuns++;
        let result = read(tick).n;
        for (let i = 0; i < K; i++) result += mode === 'aliases' ? read(aliases[i]) : read(group) + i;
        return result;
    });
    const events = [];
    const topId = top.subscribe(() => events.push(top.get()));
    const initial = K * M * (M + 1) / 2 + K * (K - 1) / 2;
    const inputs = mode === 'aliases' ? aliases : [group];
    const inputSnapshots = inputs.map(value => engine(value, 'versions'));
    const targets = new Set(inputSnapshots);
    const saved = [group, ...aliases].map(value => engine(value, 'versions'));
    const sourceIds = sources.map(source => source.getUID());
    const inputRecords = inputSnapshots.map(snapshot => sourceIds.map(id => snapshot[':' + id]));
    assert.equal(top.get(), initial);
    assert.equal(targets.size, inputs.length);
    assert.ok(inputRecords.every(records => records.every((record, i) => record === inputRecords[0][i])));
    assert.ok(inputRecords[0].every(record => record.reads instanceof Set && record.parts === undefined));
    const rawKeys = Object.keys;
    const getUIDs = sources.map(source => source.getUID);
    function count(body) {
        let keyCalls = 0, keyEntries = 0, uidCalls = 0;
        Object.keys = function(value) {
            const keys = rawKeys(value);
            if (targets.has(value)) { keyCalls++; keyEntries += keys.length; }
            return keys;
        };
        sources.forEach((source, i) => { source.getUID = function() { uidCalls++; return getUIDs[i].call(this); }; });
        try { body(); return {keyCalls, keyEntries, uidCalls}; }
        finally { Object.keys = rawKeys; sources.forEach((source, i) => { source.getUID = getUIDs[i]; }); }
    }
    try {
        const empty = count(() => {});
        const cached = count(() => { for (let i = 0; i < 16; i++) assert.equal(top.get(), initial); });
        const positive = count(() => {
            for (const snapshot of inputSnapshots) Object.keys(snapshot);
            for (const source of sources) source.getUID();
        });
        const before = {groupRuns, topRuns, aliasRuns: aliasRuns.slice()};
        const update = count(() => { tick.update(draft => { draft.n++; }); assert.equal(top.get(), initial + 1); });
        assert.deepEqual(empty, {keyCalls: 0, keyEntries: 0, uidCalls: 0});
        assert.deepEqual(cached, empty);
        assert.deepEqual(positive, {keyCalls: inputs.length, keyEntries: inputs.length * M, uidCalls: M});
        assert.deepEqual(update, {keyCalls: inputs.length, keyEntries: inputs.length * M, uidCalls: inputs.length * M});
        assert.equal(groupRuns, before.groupRuns);
        assert.deepEqual(aliasRuns, before.aliasRuns);
        assert.equal(topRuns, before.topRuns + 1);
        assert.deepEqual(events, [initial + 1]);
        const topSnapshot = engine(top, 'versions');
        assert.equal(Object.keys(topSnapshot).length, M + 1);
        assert.ok(sourceIds.every((id, i) => topSnapshot[':' + id] === inputRecords[0][i]));
        assert.ok([group, ...aliases].every((value, i) => engine(value, 'versions') === saved[i]));
        const settled = [groupRuns, topRuns, aliasRuns.slice()];
        sources[0].update(draft => { draft.noise++; });
        assert.equal(top.get(), initial + 1);
        assert.deepEqual([groupRuns, topRuns, aliasRuns], settled);
        sources[0].update(draft => { draft.n++; });
        assert.equal(top.get(), initial + 1 + K);
        assert.deepEqual(events, [initial + 1, initial + 1 + K]);
        return {K, M, mode, inputDictionaries: targets.size, distinctLeafRecords: M,
            initial, afterTick: initial + 1, final: initial + 1 + K, empty, cached, positive, update,
            finalLeaves: Object.keys(topSnapshot).length, topBodyDelta: 1, upstreamBodyDelta: 0,
            singleTickDelivery: true, snapshotsIntact: true, noiseQuiet: true, relatedWriteCorrect: true};
    } finally { top.unsubscribe(topId); group.unsubscribe(groupId); }
}
const rows = [[1, 8], [8, 1], [4, 4], [8, 8], [16, 16]].map(([K, M]) => run(K, M));
rows.push(run(8, 8, 'direct'));
console.log(JSON.stringify({probe: 'R44-C01', format, node: process.version, rows}));
```

### Recipe R44-C02

<!-- R44-C02-PROBE -->
```js
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {engine, engineKey} from './perf/harness/lib.mjs';
const root = resolve(process.argv[2]);
const format = process.argv[3];
const entry = resolve(root, 'Carburetor', format.startsWith('cjs') ? 'index.js' : 'index.mjs');
const api = format.startsWith('cjs') ? createRequire(import.meta.url)(entry)
    : await import(pathToFileURL(entry).href);
const {Carburetor, computed} = api;
const token = value => value[Symbol.for('react-carburetor/v1/computed-snapshot-version')]();

function run(M, equal) {
    const sources = Array.from({length: M}, () => new Carburetor({n: 1}));
    let bodies = 0, phase;
    const events = [];
    const value = computed(read => {
        if (phase) phase.enteredBody = true;
        bodies++;
        const sum = sources.reduce((n, source) => n + read(source).n, 0);
        return equal ? 1 : sum;
    });
    const key = engineKey('recompute', value);
    const originalRecompute = value[key];
    value[key] = function(...args) {
        const previous = phase;
        phase = {snapshot: engine(this, 'versions'), enteredBody: false};
        try { return originalRecompute.apply(this, args); }
        finally { phase = previous; }
    };
    const rawKeys = Object.keys;
    function count(body) {
        let calls = 0, entries = 0;
        Object.keys = function(object) {
            const keys = rawKeys(object);
            if (phase && !phase.enteredBody && object === phase.snapshot) {
                calls++; entries += keys.length;
            }
            return keys;
        };
        try { body(); return {calls, entries}; }
        finally { Object.keys = rawKeys; }
    }
    let id;
    try {
        const cold = count(() => { id = value.subscribe(() => events.push(value.get())); });
        const cached = count(() => { for (let i = 0; i < 16; i++) value.get(); });
        const empty = count(() => {});
        const positive = count(() => {
            phase = {snapshot: engine(value, 'versions'), enteredBody: false};
            try { Object.keys(phase.snapshot); }
            finally { phase = undefined; }
        });
        const beforeBodies = bodies;
        const observed = count(() => { sources[0].update(draft => { draft.n++; }); value.get(); });
        assert.deepEqual(cold, {calls: 1, entries: 0});
        assert.deepEqual(cached, {calls: 0, entries: 0});
        assert.deepEqual(empty, cached);
        assert.deepEqual(positive, {calls: 1, entries: M});
        assert.deepEqual(observed, positive);
        assert.equal(bodies, beforeBodies + 1);
        assert.equal(value.get(), equal ? 1 : M + 1);
        assert.deepEqual(events, equal ? [] : [M + 1]);
        assert.equal(value.getVersion(), equal ? 0 : 1);
        value.unsubscribe(id);
        id = undefined;
        const releasedToken = token(value);
        const afterRelease = count(() => { sources[0].update(draft => { draft.n++; }); value.get(); });
        assert.deepEqual(afterRelease, {calls: 1, entries: M});
        assert.equal(value.get(), equal ? 1 : M + 2);
        assert.equal(token(value), releasedToken + (equal ? 0 : 1));
        const validUnobserved = count(() => { sources[0].update(draft => { draft.n++; }); value.get(); });
        assert.deepEqual(validUnobserved, {calls: 0, entries: 0});
        assert.equal(value.get(), equal ? 1 : M + 3);
        assert.equal(token(value), releasedToken + (equal ? 0 : 2));
        return {M, equal, cold, empty, cached, positive, observed, afterRelease, validUnobserved,
            observedBodyDelta: 1, observedDeliveries: events.length, valueAndTokensCorrect: true};
    } finally {
        if (id !== undefined) value.unsubscribe(id);
        delete value[key];
    }
}
const rows = [1, 8, 32].flatMap(M => [run(M, false), run(M, true)]);
console.log(JSON.stringify({probe: 'R44-C02', format, node: process.version, rows}));
```

### Serial runner для parent, без записи probe files

Ниже самодостаточный Python runner извлекает exact code fences из **этого** отчёта и передаёт их в stdin Node. Он приведён для parent reproduction; **сам runner не исполнялся** агентом, фактические calls имели те же argv/cwd/input/timeout через Python Eval. Рекомендуется выполнять serially; источники/вывод не требуют build, mutation lib code, pressure или GC.

```python
import re
import subprocess
from pathlib import Path

cwd = Path('D:/dev/ReactCarburetor')
report = (cwd / 'docs/api-engine-review-round-44-computed-2026-10-12.md').read_text(encoding='utf-8')
for probe in ('R44-C01', 'R44-C02'):
    pattern = rf'<!-- {probe}-PROBE -->\n```js\n(.*?)\n```'
    source = re.search(pattern, report, re.S).group(1) + '\n'
    for fmt in ('esm', 'esm-prod', 'cjs', 'cjs-prod'):
        root = cwd / 'worktrees/bench-dist/acfd3e2b8e58' / fmt
        argv = ['node', '--input-type=module', '-', str(root), fmt]
        result = subprocess.run(argv, input=source, text=True, capture_output=True, cwd=cwd, timeout=30)
        print(probe, fmt, 'exit=', result.returncode)
        print(result.stdout, end='')
        if result.stderr:
            print(result.stderr, end='')
        if result.returncode:
            raise RuntimeError(f'{probe}/{fmt} failed')
```

## Полный фактический stdout

Все JSON lines ниже скопированы из соответствующих child receipts без пересчёта метрик. У каждого child `returncode=0`, `stderr=""`. Называемые `finalLeaves` в C01 относятся к сохранённому top snapshot сразу после tick; related-write result проверяется separately полем `final`.

### R44-C01: четыре formats

#### esm

```json
{"probe":"R44-C01","format":"esm","node":"v24.12.0","rows":[{"K":1,"M":8,"mode":"aliases","inputDictionaries":1,"distinctLeafRecords":8,"initial":36,"afterTick":37,"final":38,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":1,"keyEntries":8,"uidCalls":8},"update":{"keyCalls":1,"keyEntries":8,"uidCalls":8},"finalLeaves":9,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true},{"K":8,"M":1,"mode":"aliases","inputDictionaries":8,"distinctLeafRecords":1,"initial":36,"afterTick":37,"final":45,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":8,"keyEntries":8,"uidCalls":1},"update":{"keyCalls":8,"keyEntries":8,"uidCalls":8},"finalLeaves":2,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true},{"K":4,"M":4,"mode":"aliases","inputDictionaries":4,"distinctLeafRecords":4,"initial":46,"afterTick":47,"final":51,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":4,"keyEntries":16,"uidCalls":4},"update":{"keyCalls":4,"keyEntries":16,"uidCalls":16},"finalLeaves":5,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true},{"K":8,"M":8,"mode":"aliases","inputDictionaries":8,"distinctLeafRecords":8,"initial":316,"afterTick":317,"final":325,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":8,"keyEntries":64,"uidCalls":8},"update":{"keyCalls":8,"keyEntries":64,"uidCalls":64},"finalLeaves":9,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true},{"K":16,"M":16,"mode":"aliases","inputDictionaries":16,"distinctLeafRecords":16,"initial":2296,"afterTick":2297,"final":2313,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":16,"keyEntries":256,"uidCalls":16},"update":{"keyCalls":16,"keyEntries":256,"uidCalls":256},"finalLeaves":17,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true},{"K":8,"M":8,"mode":"direct","inputDictionaries":1,"distinctLeafRecords":8,"initial":316,"afterTick":317,"final":325,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":1,"keyEntries":8,"uidCalls":8},"update":{"keyCalls":1,"keyEntries":8,"uidCalls":8},"finalLeaves":9,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true}]}
```

#### esm-prod

```json
{"probe":"R44-C01","format":"esm-prod","node":"v24.12.0","rows":[{"K":1,"M":8,"mode":"aliases","inputDictionaries":1,"distinctLeafRecords":8,"initial":36,"afterTick":37,"final":38,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":1,"keyEntries":8,"uidCalls":8},"update":{"keyCalls":1,"keyEntries":8,"uidCalls":8},"finalLeaves":9,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true},{"K":8,"M":1,"mode":"aliases","inputDictionaries":8,"distinctLeafRecords":1,"initial":36,"afterTick":37,"final":45,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":8,"keyEntries":8,"uidCalls":1},"update":{"keyCalls":8,"keyEntries":8,"uidCalls":8},"finalLeaves":2,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true},{"K":4,"M":4,"mode":"aliases","inputDictionaries":4,"distinctLeafRecords":4,"initial":46,"afterTick":47,"final":51,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":4,"keyEntries":16,"uidCalls":4},"update":{"keyCalls":4,"keyEntries":16,"uidCalls":16},"finalLeaves":5,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true},{"K":8,"M":8,"mode":"aliases","inputDictionaries":8,"distinctLeafRecords":8,"initial":316,"afterTick":317,"final":325,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":8,"keyEntries":64,"uidCalls":8},"update":{"keyCalls":8,"keyEntries":64,"uidCalls":64},"finalLeaves":9,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true},{"K":16,"M":16,"mode":"aliases","inputDictionaries":16,"distinctLeafRecords":16,"initial":2296,"afterTick":2297,"final":2313,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":16,"keyEntries":256,"uidCalls":16},"update":{"keyCalls":16,"keyEntries":256,"uidCalls":256},"finalLeaves":17,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true},{"K":8,"M":8,"mode":"direct","inputDictionaries":1,"distinctLeafRecords":8,"initial":316,"afterTick":317,"final":325,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":1,"keyEntries":8,"uidCalls":8},"update":{"keyCalls":1,"keyEntries":8,"uidCalls":8},"finalLeaves":9,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true}]}
```

#### cjs

```json
{"probe":"R44-C01","format":"cjs","node":"v24.12.0","rows":[{"K":1,"M":8,"mode":"aliases","inputDictionaries":1,"distinctLeafRecords":8,"initial":36,"afterTick":37,"final":38,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":1,"keyEntries":8,"uidCalls":8},"update":{"keyCalls":1,"keyEntries":8,"uidCalls":8},"finalLeaves":9,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true},{"K":8,"M":1,"mode":"aliases","inputDictionaries":8,"distinctLeafRecords":1,"initial":36,"afterTick":37,"final":45,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":8,"keyEntries":8,"uidCalls":1},"update":{"keyCalls":8,"keyEntries":8,"uidCalls":8},"finalLeaves":2,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true},{"K":4,"M":4,"mode":"aliases","inputDictionaries":4,"distinctLeafRecords":4,"initial":46,"afterTick":47,"final":51,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":4,"keyEntries":16,"uidCalls":4},"update":{"keyCalls":4,"keyEntries":16,"uidCalls":16},"finalLeaves":5,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true},{"K":8,"M":8,"mode":"aliases","inputDictionaries":8,"distinctLeafRecords":8,"initial":316,"afterTick":317,"final":325,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":8,"keyEntries":64,"uidCalls":8},"update":{"keyCalls":8,"keyEntries":64,"uidCalls":64},"finalLeaves":9,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true},{"K":16,"M":16,"mode":"aliases","inputDictionaries":16,"distinctLeafRecords":16,"initial":2296,"afterTick":2297,"final":2313,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":16,"keyEntries":256,"uidCalls":16},"update":{"keyCalls":16,"keyEntries":256,"uidCalls":256},"finalLeaves":17,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true},{"K":8,"M":8,"mode":"direct","inputDictionaries":1,"distinctLeafRecords":8,"initial":316,"afterTick":317,"final":325,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":1,"keyEntries":8,"uidCalls":8},"update":{"keyCalls":1,"keyEntries":8,"uidCalls":8},"finalLeaves":9,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true}]}
```

#### cjs-prod

```json
{"probe":"R44-C01","format":"cjs-prod","node":"v24.12.0","rows":[{"K":1,"M":8,"mode":"aliases","inputDictionaries":1,"distinctLeafRecords":8,"initial":36,"afterTick":37,"final":38,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":1,"keyEntries":8,"uidCalls":8},"update":{"keyCalls":1,"keyEntries":8,"uidCalls":8},"finalLeaves":9,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true},{"K":8,"M":1,"mode":"aliases","inputDictionaries":8,"distinctLeafRecords":1,"initial":36,"afterTick":37,"final":45,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":8,"keyEntries":8,"uidCalls":1},"update":{"keyCalls":8,"keyEntries":8,"uidCalls":8},"finalLeaves":2,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true},{"K":4,"M":4,"mode":"aliases","inputDictionaries":4,"distinctLeafRecords":4,"initial":46,"afterTick":47,"final":51,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":4,"keyEntries":16,"uidCalls":4},"update":{"keyCalls":4,"keyEntries":16,"uidCalls":16},"finalLeaves":5,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true},{"K":8,"M":8,"mode":"aliases","inputDictionaries":8,"distinctLeafRecords":8,"initial":316,"afterTick":317,"final":325,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":8,"keyEntries":64,"uidCalls":8},"update":{"keyCalls":8,"keyEntries":64,"uidCalls":64},"finalLeaves":9,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true},{"K":16,"M":16,"mode":"aliases","inputDictionaries":16,"distinctLeafRecords":16,"initial":2296,"afterTick":2297,"final":2313,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":16,"keyEntries":256,"uidCalls":16},"update":{"keyCalls":16,"keyEntries":256,"uidCalls":256},"finalLeaves":17,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true},{"K":8,"M":8,"mode":"direct","inputDictionaries":1,"distinctLeafRecords":8,"initial":316,"afterTick":317,"final":325,"empty":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"cached":{"keyCalls":0,"keyEntries":0,"uidCalls":0},"positive":{"keyCalls":1,"keyEntries":8,"uidCalls":8},"update":{"keyCalls":1,"keyEntries":8,"uidCalls":8},"finalLeaves":9,"topBodyDelta":1,"upstreamBodyDelta":0,"singleTickDelivery":true,"snapshotsIntact":true,"noiseQuiet":true,"relatedWriteCorrect":true}]}
```

### R44-C02: четыре formats

#### esm

```json
{"probe":"R44-C02","format":"esm","node":"v24.12.0","rows":[{"M":1,"equal":false,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":1},"observed":{"calls":1,"entries":1},"afterRelease":{"calls":1,"entries":1},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":1,"valueAndTokensCorrect":true},{"M":1,"equal":true,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":1},"observed":{"calls":1,"entries":1},"afterRelease":{"calls":1,"entries":1},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":0,"valueAndTokensCorrect":true},{"M":8,"equal":false,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":8},"observed":{"calls":1,"entries":8},"afterRelease":{"calls":1,"entries":8},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":1,"valueAndTokensCorrect":true},{"M":8,"equal":true,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":8},"observed":{"calls":1,"entries":8},"afterRelease":{"calls":1,"entries":8},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":0,"valueAndTokensCorrect":true},{"M":32,"equal":false,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":32},"observed":{"calls":1,"entries":32},"afterRelease":{"calls":1,"entries":32},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":1,"valueAndTokensCorrect":true},{"M":32,"equal":true,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":32},"observed":{"calls":1,"entries":32},"afterRelease":{"calls":1,"entries":32},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":0,"valueAndTokensCorrect":true}]}
```

#### esm-prod

```json
{"probe":"R44-C02","format":"esm-prod","node":"v24.12.0","rows":[{"M":1,"equal":false,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":1},"observed":{"calls":1,"entries":1},"afterRelease":{"calls":1,"entries":1},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":1,"valueAndTokensCorrect":true},{"M":1,"equal":true,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":1},"observed":{"calls":1,"entries":1},"afterRelease":{"calls":1,"entries":1},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":0,"valueAndTokensCorrect":true},{"M":8,"equal":false,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":8},"observed":{"calls":1,"entries":8},"afterRelease":{"calls":1,"entries":8},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":1,"valueAndTokensCorrect":true},{"M":8,"equal":true,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":8},"observed":{"calls":1,"entries":8},"afterRelease":{"calls":1,"entries":8},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":0,"valueAndTokensCorrect":true},{"M":32,"equal":false,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":32},"observed":{"calls":1,"entries":32},"afterRelease":{"calls":1,"entries":32},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":1,"valueAndTokensCorrect":true},{"M":32,"equal":true,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":32},"observed":{"calls":1,"entries":32},"afterRelease":{"calls":1,"entries":32},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":0,"valueAndTokensCorrect":true}]}
```

#### cjs

```json
{"probe":"R44-C02","format":"cjs","node":"v24.12.0","rows":[{"M":1,"equal":false,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":1},"observed":{"calls":1,"entries":1},"afterRelease":{"calls":1,"entries":1},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":1,"valueAndTokensCorrect":true},{"M":1,"equal":true,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":1},"observed":{"calls":1,"entries":1},"afterRelease":{"calls":1,"entries":1},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":0,"valueAndTokensCorrect":true},{"M":8,"equal":false,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":8},"observed":{"calls":1,"entries":8},"afterRelease":{"calls":1,"entries":8},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":1,"valueAndTokensCorrect":true},{"M":8,"equal":true,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":8},"observed":{"calls":1,"entries":8},"afterRelease":{"calls":1,"entries":8},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":0,"valueAndTokensCorrect":true},{"M":32,"equal":false,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":32},"observed":{"calls":1,"entries":32},"afterRelease":{"calls":1,"entries":32},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":1,"valueAndTokensCorrect":true},{"M":32,"equal":true,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":32},"observed":{"calls":1,"entries":32},"afterRelease":{"calls":1,"entries":32},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":0,"valueAndTokensCorrect":true}]}
```

#### cjs-prod

```json
{"probe":"R44-C02","format":"cjs-prod","node":"v24.12.0","rows":[{"M":1,"equal":false,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":1},"observed":{"calls":1,"entries":1},"afterRelease":{"calls":1,"entries":1},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":1,"valueAndTokensCorrect":true},{"M":1,"equal":true,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":1},"observed":{"calls":1,"entries":1},"afterRelease":{"calls":1,"entries":1},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":0,"valueAndTokensCorrect":true},{"M":8,"equal":false,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":8},"observed":{"calls":1,"entries":8},"afterRelease":{"calls":1,"entries":8},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":1,"valueAndTokensCorrect":true},{"M":8,"equal":true,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":8},"observed":{"calls":1,"entries":8},"afterRelease":{"calls":1,"entries":8},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":0,"valueAndTokensCorrect":true},{"M":32,"equal":false,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":32},"observed":{"calls":1,"entries":32},"afterRelease":{"calls":1,"entries":32},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":1,"valueAndTokensCorrect":true},{"M":32,"equal":true,"cold":{"calls":1,"entries":0},"empty":{"calls":0,"entries":0},"cached":{"calls":0,"entries":0},"positive":{"calls":1,"entries":32},"observed":{"calls":1,"entries":32},"afterRelease":{"calls":1,"entries":32},"validUnobserved":{"calls":0,"entries":0},"observedBodyDelta":1,"observedDeliveries":0,"valueAndTokensCorrect":true}]}
```

## Пределы проверки и hand-off

- Выполнены 24 graph cases C01 и 24 scalar mode cases C02 (6 cases × 4 formats в каждой recipe). Результаты — bounded real public-API operations, не test suite и не профиль памяти/CPU. Не выполнены hardware/heap traces, GC collectibility, React UI, packed consumers, mixed-format graphs или A/B implementation.
- Body/attachment/comparator failures, reentrant subscription teardown, external silent version, captured-version collisions и live/exotic results сопоставлены по source/имеющейся coverage, но заново не исполнялись. Их прежние parent-reported результаты R43 не выдаются за личные R44 проверки.
- P2 относится к source-backed duplicate work на указанной public topology, не к доказанной wall-time регрессии любого application. P3 — узкая безопасно отделяемая observed eligibility работа, не замена atomic acceptance. Новых measurements savings после proposed change нет, потому что implementation не выполнялась.
- Parent для независимой верификации может serially исполнить две recipes выше на frozen base; при реализации сначала сохранить все semantic controls, затем применять целевые mechanism bounds и existing Derived/computed gates. Build/typecheck/lint/tests/permanent perf acceptance — задача integration owner, агент их не запускал.
- Единственная запись агента: `docs/api-engine-review-round-44-computed-2026-10-12.md`. Не создано scaffolding, temporary scripts, benchmark files или compatibility aliases.

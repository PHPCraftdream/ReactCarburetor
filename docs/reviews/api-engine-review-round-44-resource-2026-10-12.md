# API/engine review — раунд 44: ресурсы, cache ownership и lookup

Дата: **2026-10-12**. Reviewed base: **`acfd3e2b8e58210ce1076bf1683f666283216af5`**. Исполнитель: **xxs**, тема Resource.

Это **review-only**. Единственный созданный файл — этот русский Markdown-отчёт. Production, tests, benchmarks, configs, зависимости, версии и `.claude/scheduled_tasks.lock` не изменялись; commit/push, build, test suites, lint и formatters не запускались. Других исполнителей автор не запускал.

## Scope, provenance и ограничения evidence

Сначала прочитаны [R43 resource](api-engine-review-round-43-resource-2026-10-11.md) и [Resolution общего R43](api-engine-review-round-43-2026-10-11.md#resolution-реализация-r43). Его десять исправлений считаются установленными, не новыми findings. В текущем source `lastKeyArgsRef` — development-only WeakRef, production memo хранит serialized bytes; abort снимает request до listeners и освобождает eviction hint только после ownership checks. R41/R42 cutovers, SameValue fixes и исправленные React18 console fixtures также не переименовываются в R44.

Область: все файлы `lib/src/Carburetor/Resource/**`, `Models/Resource.ts`; `Interop/{createResourceReader,useResourceValue}.ts` только для границ request/cache/reader ownership. Прочитаны serialization и primitive LRU, `EvictionLedger`, runtime registry, restore/read-only preparation/removal, failure reconciliation, cancellation/supersession, view reconciliation и public consumers. Из permanent coverage прочитаны `perf/gates/{resource,cache,resource43}.mjs`, resource42 gates, cache eviction-scaling и resource43 fixture; соответствующие source tests читались, но не запускались.

`xd://lsp` запрошен, но **недоступен**: `No such tool; mounted devices: ast_edit, debug`. Symbols/references исследованы ranged reads и `grep`/`glob`; LSP-reference completeness не заявляется.

Основные probes A/B выполнены на **frozen `worktrees/bench-dist/acfd3e2b8e58/esm-prod`**, Node **v24.12.0**, `NODE_ENV=production`. [Parent receipt](../../.rush/stdin/r44-base-build.json) указывает полный reviewed SHA и build provenance: primary build после final R43 Set cleanup; `acfd3e2` не менял `lib/src`. Receipt содержит entry hashes для четырёх formats; автор **не вычислял эти hashes самостоятельно** и не собирал distributions. До получения frozen root один exploratory pilot использовал existing primary `dist/esm-prod`; он отдельно задокументирован и не служит самостоятельным доказательством base identity. Старые `90a1c6041c2d`/`fa1ad08f8cd6` bundles не исполнялись.

Всего автор исполнил **пять коротких serial Node processes**: primary pilot P1; его frozen-root вариант P2; focused fresh-promise P3; расширенный error-boundary A; portable ready/lookup B. Каждый использовал настоящие public exports и loader functions с малыми управляемыми promises, без подмены engine, timers, искусственного memory/CPU pressure, UAC или tracing. Python `subprocess.run(..., input=source, timeout=20)` подавал source на stdin Node, не создавая scratch files. Все exits — 0, stderr пустой. Exact sources, commands и Node stdout приведены ниже. CJS, development, React/browser, GC/heap, timings и hardware counters автор не исполнял. Неизмеренные последствия помечены **[INFERENCE]**.

## Ранжированный итог

| ID | Приоритет | Подтверждённый механизм | Ограничение |
|---|---|---|---|
| **R44-R-01** | **P2 — request/restore correctness** | Effectful `String(rejection)` или `Error.message` getter исполняется после единственной ownership check; старый failure затем повреждает restored answer, а single-slot стирает новый request и теряет его Success | Требуется синхронная reentry из error description; обычные inert errors проходят control |
| **R44-R-02** | **P3 — allocation opportunity** | Каждый imperative fresh `ResourceCache.load()` возвращает новый fulfilled Promise<void>: 8/32 hits → 8/32 distinct identities при нуле loaders/publications/callbacks | Не измерен whole-operation speedup; автоматические readers fresh lane обычно не вызывают |

Это одна correctness-находка и одна небольшая allocation opportunity, **не** доказательство нового общего O-дефекта или ускорения cache engine. Новый public API/cutover не предлагается.

## R44-R-01 — error description не является ownership acceptance boundary

### Достижимый consumer и source anchors

Public loader contract — `(args, signal) => Promise<T>`, без ограничения типа rejected value, [Models/Resource.ts:13](../../lib/src/Carburetor/Models/Resource.ts#L13). Raw rejection deliberately сохраняется отдельно от сериализованного `error`; [`FalsyRejections.test.ts:3–13`](../../__tests__/Engine/Resource/ResourceCache/FalsyRejections.test.ts#L3) защищает в том числе `undefined`. Реальный API-layer [`createDetailsCache.ts:10–14`](../../lib/src/ToDo/Scope/createDetailsCache.ts#L10) напрямую возвращает `api.getTodoDetails(id, signal)`, не нормализуя чужие errors.

Достижимая, реально исполненная форма consumer: loader отклоняет promise объектом с `toString()` либо обычным Error с lazy `message` getter. При построении serializable сообщения callback восстанавливает cache/slot из snapshot либо запускает следующую операцию. Например, error abstraction может выполнять application callback на первом описании ошибки; API не запрещает такие rejected values. Это **не** утверждение, что ToDo demo уже содержит такой error callback, и не обычный inert-network-error workload. Полный public пример — recipe A ниже; engine internals в нём не читаются.

Точные anchors:

- [`describeError.ts:7–12`](../../lib/src/Carburetor/Resource/describeError.ts#L7) читает `error.message` либо делает `String(error)`: оба пути могут вызвать user code. Single-slot дублирует ту же логику, [`ResourceCarburetor.ts:17–24`](../../lib/src/Carburetor/Resource/ResourceCarburetor.ts#L17).
- Cache [`settleFailure`, ResourceCacheLifecycle.ts:250–278](../../lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts#L250): проверка `isCurrent` только в начале; затем `runtime.request = undefined`, captured `entry`/`hasData`, `describeError`, запись `runtime.answer` и update. После описания **нет проверки**, что runtime/generation/entry всё ещё авторитетны. `current()` на `:270–276` защищает смену entry между draft writes, но **не** право старого request вообще начать эту publication.
- Single-slot [`settleError`, ResourceCarburetor.ts:472–482](../../lib/src/Carburetor/Resource/ResourceCarburetor.ts#L472): initial `isCurrent`, `describeError`, затем без повторной check `runtime.request = undefined`, raw answer и Error publication. Reentrant `load('b')`/`restore()` уже отменили original signal, но новый request всё равно стирается.
- Cache [`restore`, ResourceCacheState.ts:103–131](../../lib/src/Carburetor/Resource/Cache/State/Runtime/ResourceCacheState.ts#L103) отделяет старые runtime records/views и installs restored graph; slot [`restore`, ResourceCarburetor.ts:152–217](../../lib/src/Carburetor/Resource/ResourceCarburetor.ts#L152) повышает operation generation и отменяет original request. Эти корректные replacement protections оказываются обойдены продолжением failure conversion.

### Наблюдаемая evidence: recipe A

12 маленьких lanes: cache/slot × object.toString/Error.message getter × plain/restore/start. Все promises реально дождались terminal outcome; старый loader вызывает rejection, новый loader в `start` действительно вызван и получает `yes('current')`. Plain — positive control raw failure; две формы error description — независимые public triggers одного механизма.

Для `object` и `getter` результаты одинаковы:

| Owner / action | Loaders / descriptions | После original load | После всех load promises |
|---|---:|---|---|
| Cache / plain | 1 / 1 | Error, `failed:true`, raw owner сохранён | Тот же штатный Error |
| Cache / restore Success(`restored`) | 1 / 1 | **Error + data `restored` + obsolete error + failed:true**; raw owner старого runtime уже не public | Restored Success не восстановился |
| Cache / start same-key refresh | 2 / 1 | **Error** во время реально нового request, `failed:true`, старый raw failure public | Новый Success(`current`) всё-таки принят |
| Slot / plain | 1 / 1 | Штатный Error с raw rejection | Тот же Error |
| Slot / restore Success(`restored`) | 1 / 1 | **Error + restored data + старое сообщение/raw failure**, original signal уже aborted | Восстановленный Success повреждён |
| Slot / start new-key load | 2 / 1 | Старый Error; original signal уже aborted | **Новый loader закончен, но Success(`current`) потерян**, остаётся старый Error |

Cache `firstAborted:false` на restore объясняется source order: original request **уже снят до описания**, поэтому restore не находит его controller. Это не требование искусственно abort-ить settled rejection; важен detached runtime owner. Slot `firstAborted:true` доказывает, что existing cancellation реально выполнилась, а stale failure продолжил запись несмотря на неё.

**[INFERENCE]** Hook/class readers могут получить промежуточную ошибочную Error publication и disarmed retry вместо нового Pending/refresh; rendered consequence здесь не измерялось. Не заявляются дополнительные React renders, bytes, instructions или время. Механизм O(1) по числу entries; это нарушенный acceptance/lifetime boundary, а не asymptotic regression. Число terminal requests в probe не превышает двух на lane.

### Консервативное направление и риски

Считать описание rejected value полноценным user-code boundary. Перед destructive ownership writes **повторно доказать право captured request на settlement**:

1. Для slot повторная exact-current/generation check после описания обязана сохранить новый request, restore и raw error provenance. Не очищать replacement request «в пользу» завершившегося старого.
2. Для cache нельзя ограничиться `!hasRequest(key)`: restore тоже оставляет отсутствие request, но старый runtime **уже отсоединён**. Нужны captured runtime identity/generation и проверка отсутствия newer request/authoritative entry; `hasData`/status должны относиться к entry, который всё ещё имеет право принять failure, а не obsolete captured flags. Допустим иной внутренний acceptance порядок, если он не теряет reentrant replacement и existing dedup semantics.
3. Не превращать raw object/Error в новый обычный Error, не классифицировать по одному имени `AbortError`, не добавлять `.catch(() => undefined)`, retries/timers/error-normalization framework. Не подавлять неожиданный exception из getter/coercion/publication.
4. Не ломать accepted **setData до settlement** contract: active request имеет право позже поселить ответ в public replacement; [`ResourceLifecycle.test.ts:23–49`](../../__tests__/Engine/Resource/Resource/ResourceLifecycle.test.ts#L23), [`CacheInvariants.test.ts:109–127`](../../__tests__/Engine/Resource/ResourceCacheLifetime/CacheInvariants.test.ts#L109). Pilot setData rows не объявляются отдельным дефектом — этот случай не равен restore/supersession.
5. Invalidation epoch, readonly operational COW, abort-listener/root/entry replacement guards, raw falsy failures и caller-captured views остаются действующими. Нельзя безусловно отвергать каждую operational root copy: benign invalidation COW не является supersession.

**[INFERENCE]** Exact-current checks могут быть bounded metadata work без graph scan/нового public API. Выигрыш по работе или аллокациям не измерен; главная цель — не дать obsolete failure выиграть у нового owner.

### Proposed benchmark acceptance

Новая небольшая serial family **`resource44/error-description-ownership`**, public exports, две формы описания. Обязательные endpoints:

- restore из description: оставшийся restored Success/data/key/flags/raw provenance неизменны после original load; old raw не прикреплён к restored Success;
- реальный новый load из description: после его завершения текущий answer `current`, не old Error; old continuation не очищает replacement request; cache не публикует old Error/failed поверх нового Pending/refresh;
- positive controls: обычный Error, plain object description без reentry, raw `0/false/''/undefined`, failed refresh retains old data; explicit caller await contract и unexpected exception visibility прежние;
- forced replacement через `forget` + `load`, restore empty/ready, different-key slot load, same-key cache refresh; include readonly operational invalidation и setData **до** settlement, чтобы не получить «fix» ценой принятого active-request contract;
- cheap controls: absent abort/forget, unrelated invalidation, zero loader lane; никаких timers/React для deterministic ownership proof. Если добавить UI acceptance — отдельно actual committed reader/DOM, не выводить renders из store callback counts;
- R43 cancellation eviction и object-args collectibility, R42 exact provenance/demand и R41 captured snapshots должны остаться positive controls. Исторические gates не ослаблять.

## R44-R-02 — ready hit создаёт request-shaped completion без request

### Consumer, source и реально отделённая работа

[`ResourceCacheLifecycle.load:19–26`](../../lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts#L19) после key derivation/touch/freshness возвращает **`Promise.resolve()` на каждом fresh Success**. Это не promise текущего loader, не resolution/view wrapper и не primitive-key miss. Public source возвращает `Promise<void>`, [`Models/Resource.ts:116–120`](../../lib/src/Carburetor/Models/Resource.ts#L116); consumer после `await cache.load(id)` читает `getEntry(id)`.

Достижимый imperative сценарий, например prefetch на повторных navigation/hover событиях при уже loaded answer:

```ts
await detailsCache.load(id);        // свежий answer уже есть; это всё ещё public cache hit
const details = detailsCache.getEntry(id).data;
```

`createDetailsCache` использует TTL 30s/capacity 50, [`:10–14`](../../lib/src/ToDo/Scope/createDetailsCache.ts#L10). Рецепт B реально исполняет именно public hit; hydration через `setData` используется **до** окна, чтобы исключить first loader execution. Не утверждается, что текущий ToDo UI часто вызывает этот imperative hit: его manual refresh всегда fetches, а automatic readers проверяют `worthFetching` и fresh lane обычно пропускают, [`resourceReader.ts:38–42`](../../lib/src/Carburetor/Resource/Cache/Reader/resourceReader.ts#L38), [`createResourceReader.ts:300–307`](../../lib/src/Interop/createResourceReader.ts#L300). Значимость для приложения зависит от частоты imperative hits.

Recipe B: warm primitive key, один seeded ready entry; **capacity 8 и Infinity отдельно**, H=0/8/32. В каждой hit lane loader calls, version delta и subscribers callbacks — **0**; synchronous reactions — **0**, completed `.then` reactions — H. Distinct returned Promise identities — **0/8/32** при обоих capacities. Miss-only `resolve` control: 8 cold keys, loaders 0, entries 0, version delta 0. Real pending same-key load control: loaders 1, returned identity shared, итог Success.

Наблюдение — **H отдельных escaping fulfilled Promise objects**, а не измеренные allocation bytes. По source Promise.resolve invoked H раз. **[INFERENCE]** Dedicated lazily cached void-only completion позволяет ограничить именно эти completion objects до O(1) на выбранного owner вместо O(H); callback reactions, caller Promise.all arrays, key serialization, finite-capacity touch и TTL check всё равно остаются O(H). Это не устранение всей линейной работы, не ускорение loader и не сокращение числа renders. Key-memo budgets/capacity не причина наблюдаемого эффекта: hit происходит внутри бюджетов в обеих policy lanes.

### Conservative direction, reference analysis и риски

Рассмотреть **один ленивый fulfilled Promise<void> для ready/no-work cache result**, не reuse уже settled request promise: тот мог быть rejected или владеть чужими closures/provenance. Sentinel не должен держать args, payload, entry, reader или raw error. Runtime records обязаны и дальше trim-иться независимо от ready completion.

Promise chain остаётся асинхронной; каждый caller получает собственный child promise от `.then`, rejection его callback не становится общим. Pending requests, forced refresh, operational supersession и actual loader failures не объединяются с ready sentinel.

Source/reference анализ: public docs обещают in-flight sharing и ready no-loader result, [`promise-cache.md:99–108`](../promise-cache.md#the-public-surface); [`ResourceCache.test.ts:57–69,95–106`](../../__tests__/Engine/Resource/ResourceCache/ResourceCache.test.ts#L57) защищает join/freshness, не fresh unique identity. [`ReentrantLoads.test.ts:17–28,117–128`](../../__tests__/Engine/Resource/ResourceCache/ReentrantLoads.test.ts#L17) сравнивает **pending/replacement** identities. Internal hook/class identity maps относятся к owned loading work, [`createResourceReader.ts:300–337`](../../lib/src/Interop/createResourceReader.ts#L300), [`Reads.tsx:424–431`](../../lib/src/Carburetor/Component/AntiHookComponent/Reads.tsx#L424). New public signature, alias или compatibility shim не нужны.

Тем не менее fresh Promise identity — наблюдаемое изменение. Внешний caller может использовать Promise identity/expando/async-hooks для корреляции; таких external consumers repo search не доказывает отсутствующими. Ленивый per-cache owner ограничивает cross-cache sharing, но добавляет один slot/check; module-level sharing — ещё шире observable reuse. Решение только после оценки этого риска и completed-operation evidence. **Не** предлагается изменить `load` на synchronous void/T либо добавить новый метод, чтобы обойти проблему.

### Proposed benchmark acceptance

Family **`resource44/ready-completion`** должна отдельно хранить:

- mechanism lanes H=0/8/32, primitive/object args, fixed capacity 8 и Infinity: ready completion identity count ≤1 для H>0, exact H async reactions, 0 loaders/version delta/callbacks; H=0 не создаёт lazy ready sentinel;
- lookup-only cold misses: present false/0 entries/0 loaders — независимый контроль key/query path;
- actual cold loads разных keys, pending same-key joins, stale finite TTL, invalidation, forced refresh и raw failures: сохранить genuine loader work/current promise ownership, не «выиграть» пропуском запросов;
- callback throws: один caller child rejects, остальные продолжают; explicit captured objects/answers не теряют удержание; no new cache→args/payload edge;
- **отдельный uninstrumented serial completed-operation lane** fresh load+await/then с checksum. Пользовательские collections/identity probes не использовать для timings. На rollout нужны no-regression controls и убедительный gain именно целой операции; **сейчас speedup не заявляется**.

Existing `cache/pg-c1/eviction-scaling` включает `Promise.all(args.map(cache.load))` для fresh hits, [`:59–62`](../../perf/scenarios/cache/pg-c1/eviction-scaling.mjs#L59), но его gates считают dictionary/ledger walks, не returned Promise identities. `resource43/lookup-operations` — resolve lookup, loaders 0, [`gates:65–76`](../../perf/gates/resource43.mjs#L65); готовый load result там не проверяется. Новая narrow family не заменяет эти controls.

## Что исключено, повторяется либо пока не обосновано

| Проверенный участок | Disposition |
|---|---|
| Last object query graph, abort skip hint | **R43-R02/R43-R01 исправлены**. Current source использует WeakRef dev identity и surviving-entry release; новое strong-args/abort leak не заявляется. |
| Production last serialized bytes; primitive LRU | Счётчик `keyCacheSize` ограничивает **records**, не bytes; один object JSON/key memo остаётся. Это честная budget/policy граница, не доказанный graph leak после R43. `keyCacheSize:0` отключает primitive memo, не object serialization. Нового byte-budget API или очистки caller keys не предлагается. |
| Mutable arguments | Каждое non-primitive key derivation сериализуется; это необходимо для changed-value key и live-reference diagnostic. Skipping JSON по identity/version запрещено. Object order, null/undefined/nonfinite numeric collisions — existing JSON-key policy, не новое wrong-key finding. |
| Warm resolutions/views | Most-recent wrapper churn между keys — уже R30/R42. `getEntry` lazy stable view, shared absent shape, SameValue data comparison и precise reconciliation сохранены; per-key permanent resolution registry без lifetime proof не предлагается. |
| Current views, runtime raw failures | `reconcileView`/`reconcileFailure`, exact entry ownership и `trimCacheRuntime` закрывают known obsolete owners. Caller-captured resolution/payload/args и slot `reload` last.args намеренно сильные; не считаются cache leaks. Р44 не проводил GC. |
| Retained-prefix eviction | Known R32 candidate. Mixed retained/unretained visits не измерены новым public whole-operation probe; не переименован в R44 quadratic claim. All-retained amortized hysteresis и request/reader protections менять нельзя. |
| Infinity touch, default subscribe allocations | Source содержит residual bookkeeping и eager defaults/Set в subscribe; новая whole-operation/constructor evidence для этих отдельных routes не получена. Не добавлены findings ради количества. |
| Settled vs active forgetAll; readonly graph copies | Settled batching уже R31; active/overridden hooks сохраняют per-key order ради abort reentry. Full ownership clone preserving native backlinks/readonly replay не заменяется shallow-copy shortcut. |
| TTL / automatic retry / reader lifetime | Freshness rechecked на parent resolve даже без version write; timers не нужны. Failure guard/invalidation epoch, exact cancellation provenance, terminal generation и committed/speculative split — existing contracts, не новый retry/query framework. |
| Effectful setData pilot | Реально наблюдались old failure writes после setData внутри описания, но setData deliberately не cancel-ит request. В отличие от **restore/new request**, contract precedence этого частного момента не используется для независимого finding. |
| Promise<void> API, helper duplication | Imperative read-after-load ожидаем; cached query и single-slot разные semantics. Нет доказанного основания для нового `getAsync/loadValue`/optional-args overload или общего superclass cutover. |

## Exact commands и воспроизводимые bounded recipes

### A — error description ownership

**Исполнен**, frozen ESM-production. Source ниже — exact stdin `error_boundary_probe`. Actual command/env:

```text
cwd = D:/dev/ReactCarburetor
NODE_ENV = production
R44_ROOT = D:/dev/ReactCarburetor/worktrees/bench-dist/acfd3e2b8e58/esm-prod
node --input-type=module -
```

Вызов: `subprocess.run(['node','--input-type=module','-'], input=source, text=True, capture_output=True, cwd=..., timeout=20, env=...)`. Exit 0, stderr empty. Нет scratch source в checkout. Parent может сохранить этот standalone source вне tracked tree как `r44-resource-error-boundary.mjs` и выполнить `node <absolute scratch path>` с тем же env. Importer сам различает `.mjs`/CJS `.js`; runs на других formats автор **не** заявляет.

```js
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root = resolve(process.env.R44_ROOT);
const require = createRequire(import.meta.url);
const api = existsSync(resolve(root,'Carburetor/index.mjs'))
  ? await import(pathToFileURL(resolve(root,'Carburetor/index.mjs')).href)
  : require(resolve(root,'Carburetor/index.js'));
const {ResourceCache,ResourceCarburetor,EResourceStatus:S}=api;
const ready=data=>({status:S.Success,data,error:undefined,updatedAt:100,refreshing:false,invalidated:false,failed:false});
const gate=()=>{let yes,no;const promise=new Promise((a,b)=>{yes=a;no=b;});return {promise,yes,no};};
for (const kind of ['cache','slot']) for (const style of ['object','getter']) for (const action of ['plain','restore','start']) {
  const gates=[],promises=[];let calls=0,descriptions=0;
  function loader(id,signal){calls++;const g=gate();gates.push({id,signal,...g});return g.promise;}
  const owner=kind==='cache'?new ResourceCache(loader,{ttl:Infinity,maxEntries:Infinity}):new ResourceCarburetor(loader);
  const first=owner.load('a');promises.push(first);
  const key=kind==='cache'?owner.resolve('a').key:JSON.stringify('a');
  const describe=()=>{
    descriptions++;
    if(action==='restore') owner.restore(kind==='cache'?{entries:{[key]:ready('restored')}}:{...ready('restored'),key});
    else if(action==='start') promises.push(kind==='cache'?owner.refresh('a'):owner.load('b'));
    return 'obsolete offline';
  };
  const raw=style==='object'?{toString:describe}:Object.defineProperty(new Error('unused'),'message',{get:describe});
  gates[0].no(raw);await first;
  const read=()=>kind==='cache'?owner.getEntry('a'):owner.getData();
  const snapshot=()=>{const e=read();return {status:e.status,data:e.data??null,error:e.error??null,failed:e.failed??null,
    rawOwner:(kind==='cache'?owner.getFailure('a'):owner.getLastError())===raw};};
  const afterFirst=snapshot();
  gates.slice(1).forEach(g=>g.yes('current'));await Promise.all(promises);
  const afterAll=snapshot();
  console.log(JSON.stringify({kind,style,action,calls,descriptions,firstAborted:gates[0].signal.aborted,afterFirst,afterAll}));
  if(kind==='cache')owner.forgetAll();else owner.abort();
}
```

Exact Node stdout A:

```json
{"kind":"cache","style":"object","action":"plain","calls":1,"descriptions":1,"firstAborted":false,"afterFirst":{"status":"error","data":null,"error":"obsolete offline","failed":true,"rawOwner":true},"afterAll":{"status":"error","data":null,"error":"obsolete offline","failed":true,"rawOwner":true}}
{"kind":"cache","style":"object","action":"restore","calls":1,"descriptions":1,"firstAborted":false,"afterFirst":{"status":"error","data":"restored","error":"obsolete offline","failed":true,"rawOwner":false},"afterAll":{"status":"error","data":"restored","error":"obsolete offline","failed":true,"rawOwner":false}}
{"kind":"cache","style":"object","action":"start","calls":2,"descriptions":1,"firstAborted":false,"afterFirst":{"status":"error","data":null,"error":"obsolete offline","failed":true,"rawOwner":true},"afterAll":{"status":"success","data":"current","error":null,"failed":false,"rawOwner":false}}
{"kind":"cache","style":"getter","action":"plain","calls":1,"descriptions":1,"firstAborted":false,"afterFirst":{"status":"error","data":null,"error":"obsolete offline","failed":true,"rawOwner":true},"afterAll":{"status":"error","data":null,"error":"obsolete offline","failed":true,"rawOwner":true}}
{"kind":"cache","style":"getter","action":"restore","calls":1,"descriptions":1,"firstAborted":false,"afterFirst":{"status":"error","data":"restored","error":"obsolete offline","failed":true,"rawOwner":false},"afterAll":{"status":"error","data":"restored","error":"obsolete offline","failed":true,"rawOwner":false}}
{"kind":"cache","style":"getter","action":"start","calls":2,"descriptions":1,"firstAborted":false,"afterFirst":{"status":"error","data":null,"error":"obsolete offline","failed":true,"rawOwner":true},"afterAll":{"status":"success","data":"current","error":null,"failed":false,"rawOwner":false}}
{"kind":"slot","style":"object","action":"plain","calls":1,"descriptions":1,"firstAborted":false,"afterFirst":{"status":"error","data":null,"error":"obsolete offline","failed":null,"rawOwner":true},"afterAll":{"status":"error","data":null,"error":"obsolete offline","failed":null,"rawOwner":true}}
{"kind":"slot","style":"object","action":"restore","calls":1,"descriptions":1,"firstAborted":true,"afterFirst":{"status":"error","data":"restored","error":"obsolete offline","failed":null,"rawOwner":true},"afterAll":{"status":"error","data":"restored","error":"obsolete offline","failed":null,"rawOwner":true}}
{"kind":"slot","style":"object","action":"start","calls":2,"descriptions":1,"firstAborted":true,"afterFirst":{"status":"error","data":null,"error":"obsolete offline","failed":null,"rawOwner":true},"afterAll":{"status":"error","data":null,"error":"obsolete offline","failed":null,"rawOwner":true}}
{"kind":"slot","style":"getter","action":"plain","calls":1,"descriptions":1,"firstAborted":false,"afterFirst":{"status":"error","data":null,"error":"obsolete offline","failed":null,"rawOwner":true},"afterAll":{"status":"error","data":null,"error":"obsolete offline","failed":null,"rawOwner":true}}
{"kind":"slot","style":"getter","action":"restore","calls":1,"descriptions":1,"firstAborted":true,"afterFirst":{"status":"error","data":"restored","error":"obsolete offline","failed":null,"rawOwner":true},"afterAll":{"status":"error","data":"restored","error":"obsolete offline","failed":null,"rawOwner":true}}
{"kind":"slot","style":"getter","action":"start","calls":2,"descriptions":1,"firstAborted":true,"afterFirst":{"status":"error","data":null,"error":"obsolete offline","failed":null,"rawOwner":true},"afterAll":{"status":"error","data":null,"error":"obsolete offline","failed":null,"rawOwner":true}}
```

### B — ready Promise identity с отдельным cold lookup

**Исполнен**, тот же frozen ESM-production; exact stdin `ready_identity_probe`. Command/env те же, timeout 20s; exit 0, stderr empty. Portable source — `r44-resource-ready-identity.mjs` для parent scratch.

```js
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.env.R44_ROOT);
const require=createRequire(import.meta.url);
const {ResourceCache,EResourceStatus:S}=existsSync(resolve(root,'Carburetor/index.mjs'))
  ?await import(pathToFileURL(resolve(root,'Carburetor/index.mjs')).href)
  :require(resolve(root,'Carburetor/index.js'));
const ready=data=>({status:S.Success,data,error:undefined,updatedAt:Date.now(),refreshing:false,invalidated:false,failed:false});
for(const capacity of [8,Infinity])for(const count of [0,8,32]){
  let calls=0,callbacks=0,reactions=0;
  const cache=new ResourceCache(async id=>{calls++;return 'loaded-'+id;},{ttl:Infinity,maxEntries:capacity});
  const key=cache.resolve('a').key;cache.setData({entries:{[key]:ready('ready-a')}});
  const id=cache.subscribe(()=>callbacks++,{reads:new Set([cache.resolve('a').path])});
  const before=cache.getVersion();
  const ps=Array.from({length:count},()=>cache.load('a'));
  for(const p of ps)p.then(()=>reactions++);
  const synchronousReactions=reactions;await Promise.all(ps);
  assert.equal(calls,0);assert.equal(callbacks,0);assert.equal(cache.getVersion(),before);
  assert.equal(synchronousReactions,0);assert.equal(reactions,count);
  console.log(JSON.stringify({lane:'ready',capacity:Number.isFinite(capacity)?capacity:'Infinity',count,
    distinct:new Set(ps).size,calls,callbacks,versionDelta:cache.getVersion()-before,synchronousReactions,reactions}));
  cache.unsubscribe(id);cache.forgetAll();
}
let calls=0;
const cache=new ResourceCache(async id=>{calls++;return 'loaded-'+id;},{ttl:Infinity,maxEntries:8});
const before=cache.getVersion();for(let i=0;i<8;i++)assert.equal(cache.resolve('lookup-'+i).present,false);
console.log(JSON.stringify({lane:'lookup-only-miss',count:8,calls,versionDelta:cache.getVersion()-before,entries:Object.keys(cache.getData().entries).length}));
let joinCalls=0,yes;
const pending=new ResourceCache(()=>{joinCalls++;return new Promise(resolve=>{yes=resolve;});},{ttl:Infinity,maxEntries:8});
const a=pending.load('miss'),b=pending.load('miss');const shared=a===b;yes('ready');await Promise.all([a,b]);
console.log(JSON.stringify({lane:'pending-join',shared,calls:joinCalls,status:pending.getEntry('miss').status}));
pending.forgetAll();cache.forgetAll();
```

Exact Node stdout B:

```json
{"lane":"ready","capacity":8,"count":0,"distinct":0,"calls":0,"callbacks":0,"versionDelta":0,"synchronousReactions":0,"reactions":0}
{"lane":"ready","capacity":8,"count":8,"distinct":8,"calls":0,"callbacks":0,"versionDelta":0,"synchronousReactions":0,"reactions":8}
{"lane":"ready","capacity":8,"count":32,"distinct":32,"calls":0,"callbacks":0,"versionDelta":0,"synchronousReactions":0,"reactions":32}
{"lane":"ready","capacity":"Infinity","count":0,"distinct":0,"calls":0,"callbacks":0,"versionDelta":0,"synchronousReactions":0,"reactions":0}
{"lane":"ready","capacity":"Infinity","count":8,"distinct":8,"calls":0,"callbacks":0,"versionDelta":0,"synchronousReactions":0,"reactions":8}
{"lane":"ready","capacity":"Infinity","count":32,"distinct":32,"calls":0,"callbacks":0,"versionDelta":0,"synchronousReactions":0,"reactions":32}
{"lane":"lookup-only-miss","count":8,"calls":0,"versionDelta":0,"entries":0}
{"lane":"pending-join","shared":true,"calls":1,"status":"success"}
```

## Verification limits и следующий serial порядок для parent

1. Independently исполнить A на frozen esm-prod/esm/cjs-prod/cjs, затем B: small real-API ownership и ready/lookup controls отдельно. Не параллельно с heavy runtime.
2. Для R44-R-01 сначала сохранить post-conversion request/restore acceptance, затем расширить controls на readonly invalidation, failed retry, abort-listener root/entry replacement и explicit callers. Для R44-R-02 сначала решить acceptable fresh identity reuse; только потом считать whole-operation benefit. Порог milliseconds/heap bytes здесь не выдумывается.
3. Если будет реализация, parent должен сохранить existing ResourceLifecycle/ReentrantLoads/InFlightInvalidation, cache lifetime/readonly/history/key compatibility/view tests и resource40/41/42/43/cache gates. **Автор эти проверки не запускал**, их успешность не утверждается.
4. Source facts и exact small Node observations достаточны для приоритизации, но не доказательство heap savings, constructor bytes, instructions, universal latency или React render improvement. Public CJS/development, async-hooks/third-party identity consumers и UI effects остаются вне exercised evidence.

## Исполненные exploratory pilots — полное раскрытие

Пилоты не заменяют A/B и не объявляют новые findings. Ниже сохранены exact Node sources/stdout, чтобы не скрывать первичный primary-dist запуск. P2 был выполняемым source P1 с ровно двумя substitutions: import expression `resolve('dist/esm-prod/Carburetor/index.mjs')` заменён на `resolve(process.env.R44_ROOT, 'Carburetor/index.mjs')`; output property `dist:'dist/esm-prod'` заменена на `dist:process.env.R44_ROOT`. Остальные bytes body одинаковы. P1 env — NODE_ENV=production, cwd как выше; P2 дополнительно использовал текущий frozen R44_ROOT. P1/P2 commands — `node --input-type=module -`, stdin соответствующий source, timeout 20, exits 0, stderr empty. P2 именно corrected base input, не повтор user-reported failure.

### P1/P2 source

```js
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const api = await import(pathToFileURL(resolve('dist/esm-prod/Carburetor/index.mjs')).href);
const {ResourceCache, ResourceCarburetor, EResourceStatus: S} = api;
const gate = () => { let yes, no; const promise = new Promise((a,b) => { yes=a; no=b; }); return {promise, yes, no}; };
const ready = data => ({status:S.Success,data,error:undefined,updatedAt:100,refreshing:false,invalidated:false,failed:false});
const rows = [];
for (const kind of ['cache', 'slot']) {
  for (const action of ['plain','replace','start']) {
    const requests = [], promises = []; let calls=0, count=0, replacement;
    const owner = kind === 'cache' ? new ResourceCache(loader,{ttl:Infinity,maxEntries:Infinity}) : new ResourceCarburetor(loader);
    function loader(id, signal) { calls++; const g=gate(); requests.push({id,signal,...g}); return g.promise; }
    const first = owner.load('a'); promises.push(first);
    const key = kind === 'cache' ? owner.resolve('a').key : undefined;
    const raw = {toString() {
      count++;
      if (action === 'replace') {
        replacement = kind === 'cache' ? {entries:{[key]:ready('manual')}} : {status:S.Success,data:'manual',error:undefined,updatedAt:100};
        owner.setData(replacement);
      } else if (action === 'start') promises.push(kind === 'cache' ? owner.refresh('a') : owner.load('b'));
      return 'obsolete offline';
    }};
    requests[0].no(raw);
    await first;
    const read = () => kind === 'cache' ? owner.getEntry('a') : owner.getData();
    const after = read();
    const phase = {status:after.status,data:after.data ?? null,error:after.error ?? null,failed:after.failed ?? null,
      rawRetained: (kind==='cache' ? owner.getFailure('a') : owner.getLastError()) === raw};
    requests.slice(1).forEach(g => g.yes('current'));
    await Promise.all(promises);
    const end=read();
    rows.push({kind,action,calls,coercions:count,phase,end:{status:end.status,data:end.data??null,error:end.error??null,failed:end.failed??null},replacementStillInstalled:action==='replace' ? owner.getData()===replacement : null});
    if (kind==='cache') owner.forgetAll(); else owner.abort();
  }
}
console.log(JSON.stringify({node:process.version,dist:'dist/esm-prod',rows}));
```

Exact Node stdout P1 (primary dist):

```json
{"node":"v24.12.0","dist":"dist/esm-prod","rows":[{"kind":"cache","action":"plain","calls":1,"coercions":1,"phase":{"status":"error","data":null,"error":"obsolete offline","failed":true,"rawRetained":true},"end":{"status":"error","data":null,"error":"obsolete offline","failed":true},"replacementStillInstalled":null},{"kind":"cache","action":"replace","calls":1,"coercions":1,"phase":{"status":"error","data":"manual","error":"obsolete offline","failed":true,"rawRetained":false},"end":{"status":"error","data":"manual","error":"obsolete offline","failed":true},"replacementStillInstalled":true},{"kind":"cache","action":"start","calls":2,"coercions":1,"phase":{"status":"error","data":null,"error":"obsolete offline","failed":true,"rawRetained":true},"end":{"status":"success","data":"current","error":null,"failed":false},"replacementStillInstalled":null},{"kind":"slot","action":"plain","calls":1,"coercions":1,"phase":{"status":"error","data":null,"error":"obsolete offline","failed":null,"rawRetained":true},"end":{"status":"error","data":null,"error":"obsolete offline","failed":null},"replacementStillInstalled":null},{"kind":"slot","action":"replace","calls":1,"coercions":1,"phase":{"status":"error","data":"manual","error":"obsolete offline","failed":null,"rawRetained":true},"end":{"status":"error","data":"manual","error":"obsolete offline","failed":null},"replacementStillInstalled":true},{"kind":"slot","action":"start","calls":2,"coercions":1,"phase":{"status":"error","data":null,"error":"obsolete offline","failed":null,"rawRetained":true},"end":{"status":"error","data":null,"error":"obsolete offline","failed":null},"replacementStillInstalled":null}]}
```

Exact Node stdout P2 (frozen R44 root):

```json
{"node":"v24.12.0","dist":"D:/dev/ReactCarburetor/worktrees/bench-dist/acfd3e2b8e58/esm-prod","rows":[{"kind":"cache","action":"plain","calls":1,"coercions":1,"phase":{"status":"error","data":null,"error":"obsolete offline","failed":true,"rawRetained":true},"end":{"status":"error","data":null,"error":"obsolete offline","failed":true},"replacementStillInstalled":null},{"kind":"cache","action":"replace","calls":1,"coercions":1,"phase":{"status":"error","data":"manual","error":"obsolete offline","failed":true,"rawRetained":false},"end":{"status":"error","data":"manual","error":"obsolete offline","failed":true},"replacementStillInstalled":true},{"kind":"cache","action":"start","calls":2,"coercions":1,"phase":{"status":"error","data":null,"error":"obsolete offline","failed":true,"rawRetained":true},"end":{"status":"success","data":"current","error":null,"failed":false},"replacementStillInstalled":null},{"kind":"slot","action":"plain","calls":1,"coercions":1,"phase":{"status":"error","data":null,"error":"obsolete offline","failed":null,"rawRetained":true},"end":{"status":"error","data":null,"error":"obsolete offline","failed":null},"replacementStillInstalled":null},{"kind":"slot","action":"replace","calls":1,"coercions":1,"phase":{"status":"error","data":"manual","error":"obsolete offline","failed":null,"rawRetained":true},"end":{"status":"error","data":"manual","error":"obsolete offline","failed":null},"replacementStillInstalled":true},{"kind":"slot","action":"start","calls":2,"coercions":1,"phase":{"status":"error","data":null,"error":"obsolete offline","failed":null,"rawRetained":true},"end":{"status":"error","data":null,"error":"obsolete offline","failed":null},"replacementStillInstalled":null}]}
```

### P3 — focused fresh identity pilot

Frozen R44_ROOT, NODE_ENV=production; тот же stdin Node command, timeout 20, exit 0, stderr empty. Этот pilot сначала отделил fresh hit от request join; B затем добавил explicit lookup-only miss и portable importer.

```js
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {ResourceCache, EResourceStatus:S} = await import(pathToFileURL(resolve(process.env.R44_ROOT,'Carburetor/index.mjs')).href);
const ready = data => ({status:S.Success,data,error:undefined,updatedAt:Date.now(),refreshing:false,invalidated:false,failed:false});
const results=[];
for (const capacity of [8,Infinity]) for (const count of [0,8,32]) {
  let calls=0, callbacks=0, reactions=0;
  const cache=new ResourceCache(async id => { calls++; return 'loaded-'+id; },{ttl:Infinity,maxEntries:capacity});
  const key=cache.resolve('a').key;
  cache.setData({entries:{[key]:ready('ready-a')}});
  const id=cache.subscribe(()=>callbacks++,{reads:new Set([cache.resolve('a').path])});
  const before=cache.getVersion();
  const ps=Array.from({length:count},()=>cache.load('a'));
  for (const p of ps) p.then(()=>reactions++);
  const synchronousReactions=reactions;
  await Promise.all(ps);
  assert.equal(calls,0); assert.equal(callbacks,0); assert.equal(cache.getVersion(),before); assert.equal(synchronousReactions,0); assert.equal(reactions,count);
  results.push({capacity:Number.isFinite(capacity)?capacity:'Infinity',count,distinct:new Set(ps).size,calls,callbacks,versionDelta:cache.getVersion()-before,synchronousReactions,reactions});
  cache.unsubscribe(id);cache.forgetAll();
}
let calls=0,yes;
const cache=new ResourceCache(()=>{calls++;return new Promise(resolve=>{yes=resolve;});},{ttl:Infinity,maxEntries:8});
const a=cache.load('miss'),b=cache.load('miss');
const shared=a===b; yes('ready'); await Promise.all([a,b]);
results.push({control:'pending-join',shared,calls,status:cache.getEntry('miss').status});
cache.forgetAll();
console.log(JSON.stringify({node:process.version,results}));
```

Exact Node stdout P3:

```json
{"node":"v24.12.0","results":[{"capacity":8,"count":0,"distinct":0,"calls":0,"callbacks":0,"versionDelta":0,"synchronousReactions":0,"reactions":0},{"capacity":8,"count":8,"distinct":8,"calls":0,"callbacks":0,"versionDelta":0,"synchronousReactions":0,"reactions":8},{"capacity":8,"count":32,"distinct":32,"calls":0,"callbacks":0,"versionDelta":0,"synchronousReactions":0,"reactions":32},{"capacity":"Infinity","count":0,"distinct":0,"calls":0,"callbacks":0,"versionDelta":0,"synchronousReactions":0,"reactions":0},{"capacity":"Infinity","count":8,"distinct":8,"calls":0,"callbacks":0,"versionDelta":0,"synchronousReactions":0,"reactions":8},{"capacity":"Infinity","count":32,"distinct":32,"calls":0,"callbacks":0,"versionDelta":0,"synchronousReactions":0,"reactions":32},{"control":"pending-join","shared":true,"calls":1,"status":"success"}]}
```

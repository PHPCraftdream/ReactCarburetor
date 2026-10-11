# API/engine review — раунд 43: ресурсы, отмена и lifetime cache

Дата: **2026-10-11**. Reviewed base: **`90a1c6041c2d33d3e9d307a79856deb67a9a67db`**. Исполнитель: **xxs**.
Worktree/ветка: `D:/dev/ReactCarburetor/worktrees/review-r43-resource-20261011`, `review-r43-resource-20261011`.

Это **review-only**, не реализация. Источники, tests, benchmarks, distributions и зависимости не изменялись. Единственный writable/committed файл — этот отчёт. Область: `Carburetor/Resource/`, `Models/Resource.ts`, `Interop/{createResourceReader,useResourceValue}.ts`; React-файлы использованы только для границ владения ресурсами, не для общего class/hook selection.

## Evidence limits и итог

`git status --short --branch && git rev-parse HEAD` показал чистую назначенную ветку и полный SHA выше. `xd://lsp` запрошен, но недоступен: mounted devices — `ast_edit`, `debug`; символы и callers исследованы ranged reads и поиском исходников. **Runtime probes, build, tests, lint, formatters, heap/timing measurements автор не исполнял.** Ниже явно отделены факты кода от выводов **[INFERENCE]** и ещё не исполненных рецептов.

Сначала прочитаны [R42 с Resolution](api-engine-review-round-42-2026-10-10.md#resolution--2026-10-11), [R42 resource](api-engine-review-round-42-resource-2026-10-10.md), [R41 selector cutover и retention protections](api-engine-review-round-41-2026-10-09.md#resolution--2026-10-10). Их исправления не объявляются новыми дефектами. В частности, expected cancellation определяется exact source/promise provenance, а не именем `AbortError`; narrow selector, detached snapshots и unexpected rejection visibility должны сохраниться.

| ID | Приоритет / категория | Новый механизм | Уверенность |
|---|---|---|---|
| **R43-R01** | **P2, capacity/lifetime correctness** | Post-loader `abort` освобождает request, но не сбрасывает eviction hysteresis: следующая реальная попытка eviction может пропустить уже свободные entries | Высокая по коду; consumer reproduction ещё не исполнен |
| **R43-R02** | **P2, internal graph retention** | Последний object-args memo сильно держит весь граф arguments после miss/forget/restore; primitive traffic не заменяет этот owner | Высокая по strong ownership; GC collectibility ещё не исполнена |

Нет нового измеренного CPU/latency/allocation-byte выигрыша. Это две lifetime-находки, а не обещание ускорения hot resolve. Обе исправляются внутри cache ownership; новый публичный query/retry framework не нужен.

## R43-R01 — отменённый request не сообщает ledger, что появился свободный кандидат

### Reachable операция и точный механизм

Обычная операция API-layer: начать два prefetch requests, отменить старую навигацию через `abortAll()`, затем начать третий запрос. При `maxEntries: 1` превышение capacity разрешено, пока оба requests живы; после отмены старые entries уже не защищены ни request, ни reader.

Факты текущего кода:

1. `fetch` регистрирует request, создаёт/публикует Pending и вызывает eviction ещё **до loader**, [`ResourceCacheLifecycle.ts:73–104`](../lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts#L73). В рассматриваемой находке loader уже действительно вызван: это **не R42 pre-loader removal/demand**.
2. При двух Pending entries первый пустой victim scan сохраняет `retainedAtCount = 2`. `shouldSkip(1)` затем пропускает scan при `count < 4`, [`EvictionLedger.ts:106–148`](../lib/src/Carburetor/Resource/Cache/EvictionLedger.ts#L106).
3. `abortKey` снимает request owner до abort listeners, проверяет replacement, восстанавливает Idle/refreshing и retry guard, но **не вызывает `eviction.release()`**, [`ResourceCacheState.ts:441–463`](../lib/src/Carburetor/Resource/Cache/State/Runtime/ResourceCacheState.ts#L441). `abortAll` проходит тем же методом, [`:244–258`](../lib/src/Carburetor/Resource/Cache/State/Runtime/ResourceCacheState.ts#L244).
4. Ответ/rejection уже отменённого loader не помогает: обе settle branches сразу возвращаются при `!isCurrent`, [`ResourceCacheLifecycle.ts:212–214,250–252`](../lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts#L212). Обычный current settlement, напротив, сбрасывает hysteresis для retention-free key, [`:225–241,263–278`](../lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts#L225).
5. Поэтому следующий Pending `c` увеличивает count до 3, но `evict()` заканчивается на `shouldSkip`; retention predicate для отменённых `a/b` даже не вызывается, [`ResourceCacheState.ts:391–397`](../lib/src/Carburetor/Resource/Cache/State/Runtime/ResourceCacheState.ts#L391). Reader departure уже имеет нужный сигнал `release`, [`:227–234`](../lib/src/Carburetor/Resource/Cache/State/Runtime/ResourceCacheState.ts#L227).

**[INFERENCE]** После `load(a), load(b), abortAll(), load(c)` остаются два unretained Idle entries плюс Pending `c`, хотя следующий eviction уже мог удалить оба старых entries. Если отменяется refresh, старый Success payload тоже остаётся: размер удержания зависит от его графа, не только от небольшой Idle-записи. TTL не удаляет entry и не сбрасывает hysteresis; конечный TTL здесь не rescue. Новый current settlement, departure либо достаточно большой рост могут восстановить scan — это не утверждение о вечной утечке при любой дальнейшей активности.

Важно: находка **не требует немедленного eviction внутри `abort()`**. Достаточно не пропускать следующий штатный eviction после изменения retention. `abort` обещает оставить имевшиеся данные; изменение состояния на отмене и удаление при последующем capacity pressure — разные операции.

### Консервативное исправление, invariants и риски опровержения

Сигнализировать ledger о реальном переходе request-owned → retention-free после проверки synchronous abort reentry. Не запускать рекурсивный eviction/load из abort listener, не менять public post-start promise outcome и не превращать отмену в loader Error.

- Replacement request или reader продолжает защищать entry; сброс hint не разрешает игнорировать retention predicate.
- Bulk `abortAll` сохраняет одну publication, precise paths и existing failed-retry guard.
- `Success.data` при отмене refresh не очищается. Поздний ответ старого request не получает ownership заново.
- Ошибки публикации/custom source не подавляются; R42 exact-provenance handling остаётся без изменений.
- **[INFERENCE]** Hint invalidation — O(1); последующий нужный scan оплачивается обычным eviction, не новым polling/timer. Нельзя безусловно сбрасывать hysteresis на каждом load/hit: это вернуло бы R16 all-retained scaling.

Механизм опровергнут, если parent обнаружит иной вызов `release/replace/reset` в фактическом post-start abort маршруте и следующий fetch реально удалит свободные entries. Recipe ниже отдельно проверяет такую возможность, не выводит дефект только из количества entries, пока requests ещё защищены.

### Coverage gap и постоянный benchmark

[`EvictionScaling.test.ts:57–103`](../__tests__/Engine/Resource/ResourceCacheLifetime/EvictionScaling.test.ts#L57) защищает reader departure, но не отмену после пустого scan. [`Eviction.test.ts:192–209`](../__tests__/Engine/Resource/ResourceCacheLifetime/Eviction.test.ts#L192) защищает current settlement. [`AbortAll.test.ts:15–57`](../__tests__/Engine/Resource/ResourceCacheLifetime/AbortAll.test.ts#L15) проверяет coalescing/status/data при capacity по умолчанию, не этот subsequent-fetch reclaim. Существующий [`cache/pg-c1/eviction-scaling`](../perf/scenarios/cache/pg-c1/eviction-scaling.mjs#L9) держит все rows readers и считает cold/hit work, а [`cache` bulk gates](../perf/gates/cache.mjs#L104) намеренно считают оставшиеся entries на самой отмене. Эти acceptance менять не надо.

Предложение: **`resource43/cancel-frees-eviction`**. Малые размеры capacity 1/2/8, initial и Success-refresh, `abort`/`abortAll`, followed by one paused new request. Gates: свободные старые keys удалены при следующем fetch; Pending/replacement/read-held keys остаются; late retired answer не побеждает; data сохраняется до следующего eviction; loader calls точны. Empty/cheap controls: abort отсутствующего request, capacity без превышения, `maxEntries: Infinity`; positive controls: current success/failure и reader departure. Добавить post-start reentrant same-key replacement и failed retry. Если нужны work/timing метрики, отдельно считать victim visits и отдельно измерять uninstrumented completed operation; calls/visits не выдавать за bytes или instructions.

### Recipe A — `r43-resource-abort-eviction.mjs`

**Не исполнен автором.** Полностью самостоятельный файл для parent scratch. Использует настоящий `ResourceCache` и настоящий loader с небольшими управляемыми server gates; все requests заканчиваются, глобальный unexpected handler не устанавливается. `bundleFormat/importPart` повторяют существующую [resource42 fixture convention](../__tests__/Engine/Resource/ResourceCache/Views/resource42/fixture.mjs#L13), в том числе CJS **`index.js`**, не `index.cjs`.

```js
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const require = createRequire(import.meta.url);
const root = resolve(process.env.DIST_ROOT ?? process.argv[2] ?? 'dist/esm-prod');
process.env.NODE_ENV = process.argv[3] ?? 'production';
function bundleFormat(root) {
    if (existsSync(resolve(root, 'Carburetor/index.mjs'))) return 'esm';
    assert.ok(existsSync(resolve(root, 'Carburetor/index.js')));
    return 'cjs';
}
function importPart(root, part) {
    return bundleFormat(root) === 'cjs'
        ? Promise.resolve(require(resolve(root, part, 'index.js')))
        : import(pathToFileURL(resolve(root, part, 'index.mjs')).href);
}
const {ResourceCache, EResourceStatus: Status} = await importPart(root, 'Carburetor');
function fixture(options = {}) {
    const requests = [], promises = [];
    const cache = new ResourceCache((id, signal) => new Promise((yes, no) => {
        requests.push({id, signal, yes, no});
        signal.addEventListener('abort', () => {
            no(Object.assign(new Error('controlled post-start cancellation'), {name: 'AbortError'}));
        }, {once: true});
    }), {ttl: Infinity, maxEntries: 1, ...options});
    const keys = Object.fromEntries(['a', 'b', 'c'].map(id => [id, cache.resolve(id).key]));
    function start(id, refresh = false) {
        const p = refresh ? cache.refresh(id) : cache.load(id);
        promises.push(p);
        return p;
    }
    function state() {
        const entries = cache.getData().entries;
        return {count: Object.keys(entries).length,
            a: entries[keys.a]?.status, aData: entries[keys.a]?.data,
            b: entries[keys.b]?.status, c: entries[keys.c]?.status};
    }
    async function close() {
        cache.abortAll();
        await Promise.all(promises);
        cache.forgetAll();
        assert.equal(Object.keys(cache.getData().entries).length, 0);
    }
    return {cache, requests, promises, keys, start, state, close};
}
async function lane(mode, phase = 'initial', releaseControl = false, ttl = Infinity) {
    const f = fixture({ttl});
    try {
        if (phase === 'refresh') {
            const warm = f.start('a');
            f.requests[0].yes('old-a');
            await warm;
        }
        const a = f.start('a', phase === 'refresh');
        const aRequest = f.requests.at(-1);
        const b = f.start('b');
        const bRequest = f.requests.at(-1);
        assert.equal(f.state().count, 2); // both request-owned, legitimately over capacity
        if (mode === 'settle') {
            aRequest.yes('settled-a'); bRequest.yes('settled-b');
            await Promise.all([a, b]);
        } else if (mode === 'abortAll') {
            f.cache.abortAll();
            await Promise.all([a, b]);
            assert.ok(aRequest.signal.aborted && bRequest.signal.aborted);
            assert.equal(f.state().a, phase === 'refresh' ? Status.Success : Status.Idle);
            assert.equal(f.state().b, Status.Idle);
            if (phase === 'refresh') assert.equal(f.state().aData, 'old-a');
        } else {
            f.cache.abort('a');
            await a;
            assert.ok(aRequest.signal.aborted && !bRequest.signal.aborted);
        }
        if (releaseControl) {
            // Independent existing signal; wildcard observer does not pin any entry.
            const id = f.cache.subscribe(() => {});
            f.cache.unsubscribe(id);
        }
        f.start('c'); // still paused: only ownership/capacity behavior is measured
        assert.equal(f.state().c, Status.Pending);
        assert.equal(f.requests.length, phase === 'refresh' ? 4 : 3);
        const observed = f.state();
        if (releaseControl || mode === 'settle') {
            assert.equal(observed.a, undefined);
            assert.equal(observed.count, mode === 'abort' ? 2 : 1);
        }
        return {mode, phase, releaseControl, ttl: String(ttl), observed,
            missedReclaim: mode !== 'settle' && !releaseControl && observed.a !== undefined};
    } finally { await f.close(); }
}
const results = [];
for (const ttl of [Infinity, 0]) {
    results.push(await lane('abortAll', 'initial', false, ttl));
    results.push(await lane('abortAll', 'refresh', false, ttl));
}
results.push(await lane('abort'));
results.push(await lane('abortAll', 'initial', true));
results.push(await lane('abort', 'initial', true));
results.push(await lane('settle'));
// Ordinary failure/raw identity + failed retry/invalidation control, without eviction pressure.
const e = fixture({maxEntries: Infinity});
try {
    const raw = new Error('ordinary offline failure');
    const failed = e.start('a');
    e.requests[0].no(raw);
    await failed;
    assert.equal(e.cache.getFailure('a'), raw);
    assert.equal(e.cache.getEntry('a').failed, true);
    let thrown;
    try { e.cache.suspend('a'); } catch (error) { thrown = error; }
    assert.equal(thrown, raw);
    e.cache.invalidate('a');
    const retry = e.start('a');
    e.cache.abort('a');
    await retry;
    assert.equal(e.cache.getEntry('a').failed, true);
    e.cache.invalidate('a');
    const fresh = e.start('a');
    e.requests[2].yes('fresh');
    await fresh;
    assert.equal(e.cache.getEntry('a').data, 'fresh');
    assert.equal(e.cache.getEntry('a').failed, false);
    assert.equal(e.requests.length, 3);
    results.push({ordinaryFailureVisible: true, retryGuard: true, explicitRearm: true});
} finally { await e.close(); }
console.log(JSON.stringify({root, format: bundleFormat(root), results}, null, 2));
```

На current source **[INFERENCE]** bug lanes должны печатать `missedReclaim: true`; controls — false. Важны before/after states и независимый release-control, а не просто exit 0. После исправления эти bug indicators должны стать false; parent не должен закреплять их как permanent success gates.

## R43-R02 — object-key memo держит arguments graph вне entry lifetime

### Reachable операция и механизм

Object arguments — поддерживаемый обычный маршрут: [`ResourceCache.test.ts:346–354`](../__tests__/Engine/Resource/ResourceCache/ResourceCache.test.ts#L346) использует `{id: ...}` по value identity; [`resource40/Lifecycle.test.tsx:75–78`](../__tests__/Engine/Resource/ResourceCache/Views/resource40/Lifecycle.test.tsx#L75) передаёт object query публичному hook. Например, query содержит массив filters; consumer закрывает экран, забывает answer/восстанавливает пустой cache и отпускает query. Даже lookup отсутствующего key через `resolve(query)` создаёт скрытого владельца этого графа — loader/subscription не нужны.

Факты исходников:

- `lastKeyArgs` — сильное instance поле `TArgs`, рядом с JSON/key strings, [`ResourceCache.ts:77–84`](../lib/src/Carburetor/Resource/Cache/ResourceCache.ts#L77).
- Для non-primitive arguments `keyOf` **всё равно заново делает `JSON.stringify`**, затем сравнивает ссылку/JSON и сохраняет `lastKeyArgs = args`, [`:251–280`](../lib/src/Carburetor/Resource/Cache/ResourceCache.ts#L251). Strong reference служит проверке последней identity/mutation, не устраняет сериализацию.
- Primitive route возвращает `primed` раньше этих присваиваний; даже `keyCacheSize: 0` отключает только primitive memo, [`:185–204,252–254`](../lib/src/Carburetor/Resource/Cache/ResourceCache.ts#L185). Поэтому последующие primitive queries не заменяют последний object owner.
- Все references на `R.lastKeyArgs/lastKeyJson/lastKeyValue` в source находятся в этом key memo. `forget`/removal очищают runtime/view/resolution, [`ResourceCacheState.ts:363–375,404–426`](../lib/src/Carburetor/Resource/Cache/State/Runtime/ResourceCacheState.ts#L363); `restore` сбрасывает request/view/ledger, [`:103–131`](../lib/src/Carburetor/Resource/Cache/State/Runtime/ResourceCacheState.ts#L103); reconciliation очищает obsolete view/resolution, [`ResourceCache.ts:127–140`](../lib/src/Carburetor/Resource/Cache/ResourceCache.ts#L127). Но object-key memo не освобождается.

**[INFERENCE]** При живом cache последний object arguments и весь достижимый из него граф остаются живы до другого non-primitive lookup или смерти cache, даже при нуле entries/readers/requests. Это **один последний граф**, не рост числа memo-records с каждой query. Размер retention — O(A), где A — достижимый arguments graph, плюс JSON/key strings; `maxEntries` и TTL этот owner не ограничивают. GC/bytes здесь не измерены.

Отличие от R41: тот исправлял `viewCache/resolution → removed payload`; его [10-route retention benchmark](../perf/scenarios/resource41/retention.mjs#L22) использует primitive `'old'`, поэтому `lastKeyArgs` вообще не получает payload/query. Здесь удерживается **arguments**, даже когда view содержит только маленькую строку или отсутствует. Это также не новый отчёт о repeated object serialization и не known cyclic primitive-key working set above budget.

### Исправление/API tradeoff и invariants

Убрать strong ownership последнего object graph, а не добавить global clear/dispose API, чтобы consumer вручную компенсировал private memo. Консервативные варианты:

1. Weak identity последнего object для development mutation diagnostic; JSON/key memo может остаться. Живой caller query по-прежнему даёт same-reference проверку; caller не получает retention только из-за диагностики. Цена — WeakRef/record на смену object query; нужны отдельные cheap-route и allocation controls.
2. Разделить production byte-key reuse и development identity check: последний JSON уже вычислен, одинаковые JSON bytes дают тот же encoded key независимо от object identity. Нельзя ради этого пропускать текущую сериализацию изменяемого query или терять warning для живой той же ссылки.
3. Lifecycle-scoped clearing — меньшая локальная альтернатива, но нужно явно выбрать контракт diagnostic across forget/restore, guard against reentrant replacement и отдельно решить miss-only memo. Очистка только при forget не закрывает lookup без entry.

Нельзя разрушать caller-captured resolutions, canonical key/path bytes, точность selector или primitive intrusive LRU ради этого finding. `ResourceCarburetor.runtime.last.args` **не та же проблема**: `reload()` намеренно требует last arguments, [`ResourceCarburetor.ts:300–305,361–365`](../lib/src/Carburetor/Resource/ResourceCarburetor.ts#L300). У `ResourceCache` такого public last-query operation нет.

Уверенность в strong edge высокая. Runtime эффект опровергнут, если tiny liveness recipe освобождает arguments graph уже после cleanup при реально живых caches; если не собирается и unrelated/object-turnover negative control, результат GC inconclusive, не подтверждение cache bug. Small fixture не доказывает объём heap-saving или значение для всех приложений; при только `{id}` impact мал.

### Coverage gap и новый benchmark

[`KeyOf.test.ts:48–115`](../__tests__/Engine/Resource/ResourceCache/Helpers/KeyOf.test.ts#L48) защищает mutation correctness и once-per-cache diagnostic. [`resource/serialization` gates](../perf/gates/resource.mjs#L15) специально требуют одну serialization для object args. [`resource41/retention-live-cache`](../perf/gates/resource-retention41.mjs#L1) сохраняет payload/captured/strong controls, но object arguments lifetime не покрывает.

Предложение: **`resource43/object-args-lifetime`**, отдельный bounded `--expose-gc` child. Routes: miss-only resolve, seeded answer + forget/forgetAll, restore/setData empty; после каждого — primitive traffic. Targets: argument root и filters subtree; caches используются после GC. Negative controls: unrelated unreachable graph и replacement object query; positive controls: caller-held args, live entry, caller-captured resolution. Не deref перед collection и не создавать память/CPU pressure. Gate на collectibility после нескольких job/GC turns — не на синхронном unit-test GC. Отдельные key-byte/mutation/primitive-budget controls и uninstrumented object hit/miss workload должны исключить «победу» ценой broken keys либо большего hot-path churn. Старые R41 retention gates остаются неизменны.

### Recipe B — `r43-resource-object-args-lifetime.mjs`

**Не исполнен автором.** Никаких requests, async loader closures или retained React attempts в target fixtures; hydrated entry содержит строку, не query graph. Это намеренно независимое исключение альтернативного ownership механизма. Всего пять небольших graphs по 16 filters и controls; GC вызывается явно без искусственного pressure. Сохранить как отдельный parent scratch ESM-файл:

```js
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setImmediate as turn} from 'node:timers/promises';
const require = createRequire(import.meta.url);
const root = resolve(process.env.DIST_ROOT ?? process.argv[2] ?? 'dist/esm-prod');
process.env.NODE_ENV = process.argv[3] ?? 'production';
function bundleFormat(root) {
    if (existsSync(resolve(root, 'Carburetor/index.mjs'))) return 'esm';
    assert.ok(existsSync(resolve(root, 'Carburetor/index.js')));
    return 'cjs';
}
function importPart(root, part) {
    return bundleFormat(root) === 'cjs'
        ? Promise.resolve(require(resolve(root, part, 'index.js')))
        : import(pathToFileURL(resolve(root, part, 'index.mjs')).href);
}
const {ResourceCache, EResourceStatus: Status} = await importPart(root, 'Carburetor');
assert.equal(typeof globalThis.gc, 'function', 'run with --expose-gc');
let loaderCalls = 0;
function unusedLoader() { loaderCalls++; throw new Error('lookup must not call loader'); }
function graph(label) {
    return Array.from({length: 16}, (_, i) => ({field: `${label}-${i}`, values: [i, i + 1]}));
}
function entry(data) {
    return {status: Status.Success, data, error: undefined, updatedAt: Date.now(),
        refreshing: false, invalidated: false, failed: false};
}
function prepare(route) {
    const cache = new ResourceCache(unusedLoader, {ttl: Infinity, maxEntries: 0, keyCacheSize: 0});
    const query = {id: route, filters: graph(route)};
    const ref = new WeakRef(query.filters);
    const key = cache.resolve(query).key;
    if (route !== 'miss') {
        cache.setData({entries: {[key]: entry('hydrated-answer')}});
        cache.resolve(query);
        if (route === 'forget') cache.forget(query);
        else if (route === 'forgetAll') cache.forgetAll();
        else if (route === 'restore') cache.restore({entries: {}});
        else if (route === 'setData') cache.setData({entries: {}});
        else throw new Error('unknown route');
    }
    for (const id of ['primitive-a', 'primitive-b', 'primitive-c']) cache.resolve(id);
    assert.equal(Object.keys(cache.getData().entries).length, 0);
    return {route, cache, ref}; // query and filters leave this synchronous frame
}
function makeControls() {
    const query = {id: 'caller-held', filters: graph('caller-held')};
    const cache = new ResourceCache(unusedLoader, {ttl: Infinity});
    const key = cache.resolve(query).key;
    cache.setData({entries: {[key]: entry('captured-answer')}});
    const captured = cache.resolve(query);
    cache.forget(query);
    return {query, cache, captured, ref: new WeakRef(query.filters)};
}
function unreachableControl() { return new WeakRef(graph('unreachable')); }
const fixtures = ['miss', 'forget', 'forgetAll', 'restore', 'setData'].map(prepare);
const controls = makeControls();
const unreachable = unreachableControl();
async function collect() {
    for (let i = 0; i < 12; i++) {
        await turn();
        globalThis.gc();
    }
    await turn();
}
await collect();
assert.equal(unreachable.deref(), undefined, 'GC negative control; otherwise inconclusive');
assert.ok(controls.ref.deref());
assert.equal(controls.query.filters[0].field, 'caller-held-0');
assert.equal(controls.captured.view.data, 'captured-answer');
const retainedAfterCleanup = fixtures.map(f => ({route: f.route, retained: f.ref.deref() !== undefined}));
// Existing replacement route is an independent control for the specific last-object owner.
for (const f of fixtures) f.cache.resolve({id: 'replacement'});
await collect();
const releasedAfterObjectTurnover = fixtures.every(f => f.ref.deref() === undefined);
assert.ok(releasedAfterObjectTurnover, 'otherwise another owner or GC harness issue exists');
assert.equal(loaderCalls, 0);
assert.ok(fixtures.every(f => Object.keys(f.cache.getData().entries).length === 0));
assert.equal(Object.keys(controls.cache.getData().entries).length, 0);
assert.equal(controls.captured.view.data, 'captured-answer');
console.log(JSON.stringify({root, format: bundleFormat(root), retainedAfterCleanup,
    releasedAfterObjectTurnover, callerHeldAlive: controls.ref.deref() !== undefined,
    capturedSnapshotUnchanged: true, cachesAlive: fixtures.length + 1, loaderCalls}, null, 2));
```

На current source **[INFERENCE]** `retainedAfterCleanup` должен содержать пять `retained: true`, затем object-turnover освобождает все пять. Recipe не закрепляет первый outcome assertion-ом: если parent получает false с green controls, finding отвергнут. Это collectibility diagnostic, не allocated-byte benchmark.

## Что просмотрено, но не объявлено новой находкой/API

- **Warm hit/resolution records.** Most-recent resolution wrapper churn при нескольких keys, повторная object serialization и finite-capacity touch уже раскрыты R30/R42; нового whole-operation evidence здесь нет. Per-key permanent resolution cache осложнит R41 cleanup — не предлагается.
- **Retained-prefix eviction walk.** Повторный обход old retained entries известен [R32:313–316](api-engine-review-round-32-2026-10-04.md#L313). Не переименовывается в R43 O-finding; для более сильного утверждения о смешанном сверх-capacity workload нужны отдельный proof и safe retention index design. R43-R01 — иной механизм: отсутствует сигнал о реально освобождённом request.
- **TTL.** Resolve на parent render необходим: freshness меняется без version write, [`useResourceValue.ts:28–31`](../lib/src/Interop/useResourceValue.ts#L28). Не предлагаются version-only memo, TTL timers или автоматическое удаление старых answers.
- **Load/settle.** R40 уже сократил path rewalk через captured draft entry, сохранив current-root guards. Prepared readonly ownership, raw failure owner и in-flight invalidation epochs не заменяются shallow copies/безусловными retries. [`InFlightInvalidation.test.ts:17–105`](../__tests__/Engine/Resource/ResourceCache/Regressions/InFlightInvalidation.test.ts#L17) остаётся обязательным control, не новой находкой.
- **Reader lifecycle.** Closed selector input, committed/speculative split, explicit resolution, stable completed reads и generation-scoped terminal demand сохраняются. [`createResourceReader.ts:300–339`](../lib/src/Interop/createResourceReader.ts#L300) уже владеет двумя terminal branches; `.catch(() => undefined)` или classification по одному имени ошибки недопустимы. Broad retries/полное resource selection вместо mandatory selector не предлагаются.
- **Promise<void> ergonomics.** Imperative consumer действительно вынужден прочитать status/data после `load`: [`TodoCarburetor.ts:79–89,191–201`](../lib/src/ToDo/Carburetors/TodoCarburetor.ts#L79). Но loader failure как resource state и post-start cancellation outcome уже приняты tests; новый `load(): Promise<T>` менял бы contract, dedup/outcome и stale-answer ownership. Без нового reachable defect/второго реального use case не предлагается ещё один `fetch/getAsync` alias. Конкретные R43 fixes не требуют публичной поверхности.

## Parent verification order и точные команды

1. **Recipe A**, отдельный процесс на format: сначала capacity/cancellation states с controls; это не heap/timing test. Затем **Recipe B** с `--expose-gc`, не одновременно с другими GC/CPU workloads.
2. Read-only immutable current bundles для проверки предоставлены parent: `D:/dev/ReactCarburetor/worktrees/bench-dist/90a1c6041c2d/{esm,esm-prod,cjs,cjs-prod}`. По сообщению parent, они скопированы из уже built/smoked primary dist этого base, без rebuild. Автор отчёта **не проверял их исполнением**. `DIST_ROOT` означает конкретный format directory; argv root используется, когда переменная не установлена.
3. Сохранить code blocks A/B вне source/distribution как два указанных scratch files. Команды (cwd назначенного worktree; `worktrees/r43-parent-probes/` — пример scratch parent, автор его не создавал):

```text
node worktrees/r43-parent-probes/r43-resource-abort-eviction.mjs D:/dev/ReactCarburetor/worktrees/bench-dist/90a1c6041c2d/esm-prod production
node worktrees/r43-parent-probes/r43-resource-abort-eviction.mjs D:/dev/ReactCarburetor/worktrees/bench-dist/90a1c6041c2d/esm development
node --expose-gc worktrees/r43-parent-probes/r43-resource-object-args-lifetime.mjs D:/dev/ReactCarburetor/worktrees/bench-dist/90a1c6041c2d/esm-prod production
node --expose-gc worktrees/r43-parent-probes/r43-resource-object-args-lifetime.mjs D:/dev/ReactCarburetor/worktrees/bench-dist/90a1c6041c2d/esm development
```

Для CJS заменить format directory на `cjs-prod`/`cjs`; helper обнаруживает suffix по реальным файлам. Если используется `DIST_ROOT`, unset перед argv matrix, иначе он намеренно имеет precedence. Никакой зависимости от расположения scratch файла или node_modules junction для этих двух recipes нет.

4. Если механизмы подтверждены, перед реализацией отдельно согласовать invariant: **не immediate abort eviction**, а invalidation его skip-hint; **не last-query public API**, а освобождение private arguments owner. После fix parent запускает tests `ResourceCacheLifetime/{Eviction,EvictionScaling,AbortAll}`, `ResourceCache/{Helpers/KeyOf,Regressions/InFlightInvalidation,Regressions/PrimitiveKeyMemo,Regressions/PrimitiveKeyFastPath}`, затем existing `resource40`, `resource41`, `resource42` и `cache` permanent gates. Особенно сохранить R41 caller-captured payload liveness и R42 `visibleUnexpected`, generation/replacement ownership, narrow-selector warm controls. Их результаты здесь не заявлены.

### Raw-source citations

- Capacity/ownership: [`EvictionLedger.ts:93–148`](../lib/src/Carburetor/Resource/Cache/EvictionLedger.ts#L93), [`ResourceCacheState.ts:227–258,391–463`](../lib/src/Carburetor/Resource/Cache/State/Runtime/ResourceCacheState.ts#L227), [`ResourceCacheLifecycle.ts:19–27,73–104,200–278`](../lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts#L19).
- Arguments memo and cleanup: [`ResourceCache.ts:77–84,127–140,185–204,251–280,365–379`](../lib/src/Carburetor/Resource/Cache/ResourceCache.ts#L77), [`ResourceCacheState.ts:103–131,363–375,404–426`](../lib/src/Carburetor/Resource/Cache/State/Runtime/ResourceCacheState.ts#L103).
- API/precision invariants: [`Models/Resource.ts:75–120`](../lib/src/Carburetor/Models/Resource.ts#L75), [`createResourceReader.ts:66–107,167–189,239–249,300–339`](../lib/src/Interop/createResourceReader.ts#L66), [`useResourceValue.ts:24–49`](../lib/src/Interop/useResourceValue.ts#L24), [`resourceReader.ts:13–46`](../lib/src/Carburetor/Resource/Cache/Reader/resourceReader.ts#L13), [`isCacheSupersededError.ts:11–25`](../lib/src/Carburetor/Resource/Cache/Reader/isCacheSupersededError.ts#L11).

## Parent verification — 2026-10-11

Parent лично исполнил обе recipes на **esm-prod/esm/cjs-prod/cjs** immutable reviewed base:
8 serial Node v24.12.0 processes, successful meaningful controls. Author runtime limits
выше относятся к source-review phase; этот раздел добавлен parent в squash. Source/fixes
и existing benchmark contracts не менялись.

- **R01:** abortAll initial/refresh при TTL Infinity/0 и individual abort дают missedReclaim=true.
  При maxEntries=1 следующая paused request оставляет count 3. Independent reader release:
  abortAll count 1, individual abort count 2 с preserved pending sibling. Current settlement
  count 1. Raw ordinary failure visibility, canceled failed retry и explicit invalidation rearm
  проходят. Отмена refresh сохраняет old-a до следующего eviction.
- **R02:** пять miss/forget/forgetAll/restore/setData-empty targets retained после cleanup и
  primitive traffic при живых caches. New object query освобождает все 5. Empty control
  collectible; caller-held graph live, captured answer unchanged, loader calls 0.

Parent LSP подтвердил 4 lastKeyArgs references без lifecycle clearing и 5 EvictionLedger.release
references без abort route. Counter/liveness findings не выдаются за heap-byte savings,
невозможность GC вообще или measured latency improvement.
Raw receipts: `.rush/stdin/r43-core-probes.json`; [общий R43 отчёт](api-engine-review-round-43-2026-10-11.md)
содержит source/runtime limits, порядок реализации и original report-commit provenance.

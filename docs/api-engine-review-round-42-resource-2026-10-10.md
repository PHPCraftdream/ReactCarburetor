# API/engine review — раунд 42: resource API и lifecycle

Дата: **2026-10-10**. Reviewed base: **`fa1ad08f8cd6b26f175235a435976fcb9d94dd22`**.
Worktree: `D:/dev/ReactCarburetor/worktrees/review-r42-resource-20261010`, ветка `review-r42-resource-20261010`.

Это **исследование, не реализация**. Единственное tracked изменение — этот отчёт. Исследованы resource-facing selection/resolve, ownership запроса, invalidate/load/refresh/forget/restore/eviction и освобождение reader. Общий selection algorithm и React scheduling не пересматриваются.

Опубликованная база имеет authoritative GREEN [GitHub CI 38075943238](https://github.com/PHPCraftdream/ReactCarburetor/actions/runs/38075943238), **11/11 jobs**, согласно общему заданию. Это не новый запуск CI автором отчёта. Новые proofs ниже используют предоставленный read-only compiled distribution этой базы; build/lint/tests/formatters/perf sweeps не запускались.

## Краткий итог

| ID | Приоритет | Наблюдённая проблема | Основные source anchors | Классификация evidence |
|---|---|---|---|---|
| **R42-R01** | P2, correctness | `forget`/`restore` из синхронного Pending subscriber, до вызова loader, оставляют committed hook на отсутствующем entry: `loading`, 0 loader calls, 0 lifecycle notifications; помогает только новый parent render | [`createResourceReader.ts:166–188`](../lib/src/Interop/createResourceReader.ts#L166), [`:299–322`](../lib/src/Interop/createResourceReader.ts#L299) | Actual public React/JSDOM + отдельный compiled-reader proof без React; phase controls |
| **R42-R02** | P2, correctness | Автоматические hook/class loads оставляют ожидаемый pre-loader `AbortError` глобально необработанным; даже catch исходного `load()` promise не обрабатывает отброшенный promise от `.then()` | [`createResourceReader.ts:306–322`](../lib/src/Interop/createResourceReader.ts#L306), [`Reads.tsx:401–418`](../lib/src/Carburetor/Component/AntiHookComponent/Reads.tsx#L401), [`createCacheSupersededError.ts:1–7`](../lib/src/Carburetor/Resource/createCacheSupersededError.ts#L1) | Actual `unhandledRejection` events, hook/class matrix, explicit-load и ordinary-loader-failure controls |

Две находки имеют общий trigger, но разные acceptance: обработать rejection **недостаточно**, чтобы восстановить потерянный loading demand; восстановить demand **недостаточно**, чтобы обработать отброшенный rejection. Нового доказанного performance speedup нет.

## Среда, идентичность build и прочитанный scope

- Реально использованы Node **v24.12.0**, React **19.3.0**, ReactDOM **19.3.0**, JSDOM **30.0.1**; `NODE_ENV=production` устанавливается до dynamic imports.
- Каждый subprocess запущен с cwd назначенного worktree. Imports — только его `dist/esm-prod`, зависимости — предоставленный read-only `node_modules` junction. DOM globals устанавливаются **до** загрузки interop, поэтому это client lane, не SSR.
- `git status --short --branch && git rev-parse HEAD && node --version` до исследования дал чистую ветку `review-r42-resource-20261010`, полный base SHA выше и `v24.12.0`.
- Реальный `realpathSync` разрешил `dist/esm-prod` в `D:/dev/ReactCarburetor/worktrees/bench-dist/fa1ad08f8cd6/esm-prod`. SHA-256 прочитанных compiled modules:

| Module относительно `dist/esm-prod` | SHA-256 |
|---|---|
| `Carburetor/index.mjs` | `a21d29ea69b7a6f9f6da09b785fda2e5e1798fa4767caa473971baaf562104da` |
| `Carburetor/Resource/Cache/ResourceCacheLifecycle.mjs` | `60d9db07c38b0b6aa8a041adadcf67ca06c899b2a9e66ba18a7e8c6067749f5f` |
| `Interop/createResourceReader.mjs` | `5f11a3d23f775d9c9fce47810c0429b60986186942fee958fb801213bf847e5a` |

Прочитаны текущие `Interop/{createResourceReader,useResourceValue}.ts`, `Models/Resource.ts`, `ResourceCache`, `ResourceCacheLifecycle`, `ResourceCacheState`, `EvictionLedger`, `resourceReader`, `createResourceFieldView`, request preparation, runtime registry, removal и restore boundaries. Из contracts — `docs/promise-cache.md`, R40, R41 resolution `:238–337`, R39 cancellation follow-up и recorded limits R37/R39, resource sections `perf/README.md`. Из coverage — все три `Views/resource41` files, `resource40/Lifecycle`, relevant reentrant-load/in-flight-invalidation/readonly-eviction/primitive-key sections, scenarios `resource40/*`, `resource41/{memo-data,retention}` и resource/cache gates. Это source review, **не исполнение suites**.

`xd://lsp` запрошен, но устройство недоступно (`No such tool`, mounted: `ast_edit`, `debug`); references исследованы `glob`/`grep` и ranged reads.

## R42-R01 — потеря loading demand при pre-loader removal

### Проблема и точная граница

Публичный cache subscriber вправе синхронно отменить/забыть request при Pending publication. Cache специально регистрирует request **до** публикации и проверяет его актуальность **до** вызова loader: [`ResourceCacheLifecycle.ts:83–104,140–154`](../lib/src/Carburetor/Resource/Cache/ResourceCacheLifecycle.ts#L83). Устаревший request не запускает loader и возвращает rejected promise. Это корректный cache contract, уже прямо описанный в [`promise-cache.md:112–113`](promise-cache.md#L112) и закреплённый `ReentrantLoads.test.ts:70–135`.

Но hook может пройти весь цикл `absent → Pending → removed/absent` внутри своего `source.load()`. Если внешний subscriber зарегистрирован до reader, callback reader уже видит итоговое отсутствие, а не промежуточный Pending. Значение narrow selector осталось `undefined`; previous/current `present` оба false. `evaluate` не меняет lifecycle token. Post-load `refresh()` также видит отсутствие; успешного settlement, на который установлен rearm handler, не будет.

**Наблюдение:** mounted public `useResourceValue(cache, 'x', view => view.data?.name)` остаётся на `loading`; это не только React scheduling — отдельный compiled-reader proof получает то же отсутствие notification при реально изменившейся source version.

### Evidence и controls

`node worktrees/r42-resource-probes/removal-boundary.mjs`:

| Операция / фаза | Actual loader calls до rescue | Hook renders до rescue | Entry | DOM | Дальнейший результат |
|---|---:|---:|---|---|---|
| `forget`, во время Pending до loader | 0 | 1 | absent / Idle | `loading` | Unrelated parent tick запускает 1 loader; settlement даёт `ready` |
| `restore({entries:{}})`, та же фаза | 0 | 1 | absent / Idle | `loading` | Тот же rescue: 1 loader, `ready` |
| `forget`, **после** запуска loader | 2 | 2 | present / Pending | `loading` | Replacement автоматически запущен; old answer `retired` не побеждает, итог `ready` |
| `restore`, после запуска loader | 2 | 2 | present / Pending | `loading` | Тот же корректный control |
| Любая из двух removals до loader, но subscriber сам запускает replacement | 1 | 1 | present / Pending | `loading` | Replacement сохраняет ownership и доставляет `ready` без rescue |

Wait window — два turns по 20 ms с `flushSync(() => {})`, не timeout gate и не timing measurement. Более сильное доказательство отсутствия сигнала — `node worktrees/r42-resource-probes/reader-removal.mjs`, без React:

```json
{"action":"forget","removed":true,"calls":0,"notifications":0,"sourceVersionDelta":3,"tokenUnchanged":true,"present":false,"status":"idle","unhandled":["AbortError"]}
{"action":"restore","removed":true,"calls":0,"notifications":0,"sourceVersionDelta":2,"tokenUnchanged":true,"present":false,"status":"idle","unhandled":["AbortError"]}
```

`cancellation.mjs` также даёт class positive control: class `useResource` после pre-loader `forget`/`restore` реально запускает replacement, 1 loader call, DOM `ready`. Это не claim, что hook и class должны иметь одинаковое общее число renders.

### Почему это новое, а не повтор R39/R41

R39 follow-up защищал removal **существующего** Pending entry внутри delivery/throttle window; R41 `CommitBoundaries.test.tsx:168–198` удаляет Pending **после** mounted loader уже начался. Эти маршруты остаются положительными в новом phase control. Новая граница — request успел опубликовать Pending и быть удалён **до вызова loader**, прежде чем hook принял present resolution. R41's ordinary absent-to-Pending suppression и detached selector semantics не предлагается откатить.

### Safe action, tradeoffs и invariants

Предлагается исправить terminal loading lifecycle, не broad retry policy: актуальный reader должен обработать завершение **своего** pre-loader-superseded request. Если current canonical entry всё ещё отсутствует, reader активен, generation/args/source актуальны и committed demand всё ещё eligible, потерянный loading signal должен создать новый lifecycle token/notification и дать следующему commit/effect выполнить load. Если replacement уже Pending/refreshing, вмешиваться нельзя. Не вызывать loader рекурсивно из Pending subscriber или render.

- Не полагаться на equality selected value для существования loading работы; сохранённое `undefined` — не доказательство, что request ещё жив.
- Не превращать ordinary failed loader в auto retry: сохраняются `failed`, invalidation epochs и ручное re-arm. Нужна именно классификация expected pre-loader supersession, описанная в R42-R02, а не catch всех ошибок.
- Source/args switch, unmount и StrictMode cleanup обязаны disarm старое continuation через текущий generation ownership. Событие старого request не может загрузить старый key или разбудить новый source.
- Эквивалентные args должны оставаться одним canonical key; новые eager serializers, per-key permanent promises или публичный retry API не нужны.
- [INFERENCE] Такой terminal check может оставаться O(1) сверх существующего `resolve`/notification; whole-operation latency и allocation delta не измерены. Дополнительный render уместен только на реально потерянном demand; обычные mount/equal-refresh counters нельзя ослаблять.

**Новый benchmark, пока не создан:** `resource42/pre-loader-removal` — actual hook mount + один синхронный pre-loader removal для `forget`/`restore`, paused replacement, без unrelated parent rescue. Gates: obsolete loader calls 0; replacement loader calls ровно 1; DOM после settlement `ready`; source/args replacement и unmount не rearm старое поколение. Встроить положительные controls «removal после начала loader» и «subscriber уже создал replacement». Текущая база отрицательна на replacement без rescue; не нужно менять production для отрицательной проверки.

Сохранить старые `resource40/hook-renders@50`, `resource40/no-load-in-render`, `resource41/machinery@1000`, `resource41/snapshot-lifecycle`; `CommitBoundaries` (TTL, abandonment, removal, source replacement, failure guards), `ReentrantLoads` (request join/supersession/reentry), `InFlightInvalidation` — обязательные будущие regression checks.

## R42-R02 — expected supersession превращается в global unhandled rejection

### Проблема, evidence и novelty

`ResourceCache.load()` обязан reject named `AbortError`, если request был отменён/замещён до запуска loader. Явный caller может await/catch этот promise. Hook не возвращает его caller; class reader также скрывает свой deferred load. Оба для field-capable cache ставят только `.then(onFulfilled)` и отбрасывают возвращённый promise.

Actual `node worktrees/r42-resource-probes/cancellation.mjs`:

| Reader | Trigger | Calls / конечный DOM | Global `unhandledRejection` |
|---|---|---|---|
| Explicit `load` + await/catch | `abort`, `forget`, `restore` до loader | 0 calls; caught `AbortError` | 0 для каждого |
| Hook | `abort` до loader | 1 call, `ready` | 1 `AbortError` |
| Hook | `forget` / `restore` до loader | 0 calls, `loading` | 1 для каждого |
| Class `useResource` | `abort`, `forget`, `restore` до loader | 1 call, `ready` для каждого | 1 для каждого |
| Hook / class | Ordinary loader throws `Error('offline')` | 1 call, `offline`, Error, `failed:true` | 0 для каждого |

Все шесть observed global cancellations имеют сообщение `Resource request was superseded before it started`. Ordinary loader failure — контроль штатного resource Error state, а не неподдерживаемый source.

В `removal-boundary.mjs` instrumentation дополнительно catch-ит **исходный** promise каждого публичного `cache.load()`. В каждой pre-loader removal lane stdout остаётся:

```json
{"caughtOriginals":["AbortError"],"unhandled":[{"name":"AbortError","isOriginalLoadPromise":false}]}
```

То есть необработан именно новый promise от `.then()`, не «caller забыл обработать исходный load». В lanes с уже работающим replacement DOM исправно становится `ready`, но global event остаётся — независимость от R42-R01 наблюдается исполнением.

Это не R39's custom-source rejection follow-up: там намеренно сохранена видимость ошибок custom source без `fieldView` (`round-39:524–525`). Здесь стандартный `ResourceCache` с `fieldView` генерирует **ожидаемый operational cancellation**, не loader failure. Отчёт не предлагает спрятать произвольные custom-source ошибки.

### Safe action, tradeoffs и invariants

Автоматический reader должен владеть обеими terminal ветками promise: очистить matching settlement и потребить именно expected cache supersession. У явного `load()` public rejection contract остаётся неизменным. Для disappeared-entry active demand применяется R42-R01; pending replacement, released reader и более новое поколение нельзя трогать.

- Не добавлять безусловный `.catch(() => undefined)` и не считать любое внешнее `Error` с `name === 'AbortError'` своим cancellation. Сейчас factory возвращает обычный Error с изменённым name; безопасная future implementation должна различать свой operational outcome и неожиданный source/publication failure, сохранив существующую видимость последних.
- Успешный settlement продолжает rearm invalidation, пережившую request; обычные loader failures продолжают попадать в cache Error/failed state и disarm retries.
- Child promise не должен остаться rejected после обработанного expected outcome. Ошибка из fulfillment/resolve callback не должна исчезнуть «за компанию».
- Не добавлять error-поле/UI Error на обычный abort, не менять старую Success data при отменённом refresh, не забирать чужой replacement promise.
- [INFERENCE] Обработка terminal ветки не требует нового публичного API и может быть одним bounded continuation на request. Allocation/CPU выигрыш не измерен; цель — корректный ownership async результата. Возможные реакции глобального error handler или завершение Node процесса зависят от окружения и здесь не исполнялись: наблюдалось только событие.

**Новый benchmark, пока не создан:** `resource42/auto-load-supersession` — отдельный real Node/React child, hook и class, одноразовая pre-loader отмена/замещение. Exact metrics: expected global rejection count **0**, explicit await/catch сохраняет `AbortError`, obsolete loader calls **0**, replacement ownership и DOM проверяются отдельно. Добавить initial/refresh/failed-retry phases, `forgetAll`, args/source swap и teardown; дополнительные phases — план, не observed coverage. Обычный loader Error и неожиданная ошибка custom source нужны как разные controls, чтобы «победа» не состояла в подавлении всех ошибок.

Старые gates: `resource40/*`, `resource41/snapshot-lifecycle`, `resource41/dependency-precision`; tests `ReentrantLoads.test.ts:70–179`, `CommitBoundaries.test.tsx:254–279`, `InFlightInvalidation`, raw-failure replacement и readonly request/eviction coverage. Их новые результаты автором не заявляются.

## Performance/API candidates, не повышенные до findings

1. **Warm stable selector и completed dependencies действительно reuse-ятся.** `warm-cost.mjs`: 8 parent frames, один key — 32 resolves, 0 изменений identity resolution; два разных keys — 64 resolves, 48 изменений identity resolution. В обеих lanes selector calls, extra memo-child renders, subscription adds/removes, loader calls и version delta — **0**. Observed leaf write затем даёт ровно 1 child render (`visible` / `visibleb`); после unmount 0 observers, adds/removes balanced.
   - Single most-recent resolution slot (`ResourceCache.ts:372–379`) churn-ит wrappers при чередовании keys, но не выполняет detachment selection заново. Identity counter — **не total allocation bytes**, и timings не измерялись. Стоимость resolution record уже обсуждалась R30-08; добавление per-key cache ради этих 48 объектов без whole-operation relevance не обосновано и усложнит R41 retention cleanup. Это измеренный остаточный cost, **не новый R42 finding**.
2. **TTL resolve на каждом parent render — необходимый freshness check.** `useResourceValue.ts:28–31`; clock freshness не обязана менять source version. [INFERENCE] Memo по одной version без TTL recheck был бы некорректен. Новая smoke использует `ttl:Infinity`; finite TTL уже описан контрактом и прочитан в `CommitBoundaries:56–114,145–166`, но здесь заново не исполнялся.
3. **Fresh inline selector и custom comparator не дают stable-selector zero-machinery обещания.** Selector/comparator identity входят в eligibility; custom comparison получает detached значения и не блокирует migration dependency. Отменять detachment перед custom comparison ради allocation saving небезопасно. Это R41 policy, не новая проблема. Generic graph reconcile, flat outer-spine copy, conservative object-keyed native equality, positional/topology floors и cyclic key working set уже записаны R37/R39 и здесь не переименованы в находки.
4. **Class field facade — отдельный intentional API.** Raw/coarse `useResource` не обещает detached narrow memo child; `connectSelection` для этого уже существует. Local Proxy target copy и lazy overrides — текущий контракт. Eager read-proxy sharing между readers или reusable открытый recorder не предлагаются.
5. **Retention reconciliation после removal/replacement — обязательная работа.** R41 уже освобождает obsolete internal view/resolution, сохраняя caller-captured resolution. Тут не выполнены GC/heap checks и не объявлен новый retention bug. Планировать per-key memo без защиты `resource41/retention-live-cache` нельзя.
6. **Key/TTL/LRU work:** primitive key memo budget, object-args serialization/mutation check и конечный capacity LRU сохраняются. В load/restore коде ещё есть `touch` при unlimited capacity, но finite/Infinity read-path work уже обсуждался R30-08; без новой whole-operation/heap evidence это не новая находка. Нельзя объявить speedup по одному вызову `Map.delete/set`.
7. **API ergonomics:** mandatory synchronous selector, detached readonly-by-contract output и optional observational-equivalence comparator достаточно явно документированы в `promise-cache.md:129–168`. Нет оснований возвращать двухаргументный overload, mutable hook facade, TTL timers, retries, normalization или alias-scan API. Найденные проблемы исправляются в owned loading lifecycle, не расширением публичной поверхности.

## Воспроизведение и точные команды

Все четыре tiny proofs сохранены **внутри назначенного worktree**, в игнорируемом `worktrees/r42-resource-probes/`. Они не входят в tracked diff. Команды реально выполнены по одному разу, exit code каждого **0**; assertions фиксируют observed bug/control states, а не заявляют исправление:

```text
cwd = D:/dev/ReactCarburetor/worktrees/review-r42-resource-20261010
node worktrees/r42-resource-probes/cancellation.mjs
node worktrees/r42-resource-probes/removal-boundary.mjs
node worktrees/r42-resource-probes/warm-cost.mjs
node worktrees/r42-resource-probes/reader-removal.mjs
```

- `cancellation.mjs`: 3 caught explicit-load controls, 6 hook/class cancellation lanes с одним global event каждая, 2 ordinary-failure controls без events. Полные versions и результаты напечатаны JSON.
- `removal-boundary.mjs`: 6 phase lanes (`forget`/`restore` × before/after/before-with-replacement), explicit catch исходного load, origin check отброшенного promise, parent rescue и retired-answer control. Exact counters — таблицы выше.
- `warm-cost.mjs`: одна и две canonical entries × 8 warmed parent frames; identity counters и реальный memo-child/DOM/subscription positive control. Без wall-clock measurements.
- `reader-removal.mjs`: два compiled-reader cases без DOM/React; точный stdout приведён выше.

Команда fingerprints, реально выполненная из того же cwd:

```text
node --input-type=module -e "import {realpathSync, readFileSync} from 'node:fs'; import {createHash} from 'node:crypto'; for (const p of ['dist/esm-prod/Carburetor/index.mjs', 'dist/esm-prod/Carburetor/Resource/Cache/ResourceCacheLifecycle.mjs', 'dist/esm-prod/Interop/createResourceReader.mjs']) console.log(JSON.stringify({path:p,target:realpathSync(p),sha256:createHash('sha256').update(readFileSync(p)).digest('hex')}));"
```

### Self-contained executable proof

Ниже полный фактически исполненный `removal-boundary.mjs`. Он воспроизводит оба hook findings и controls через **публичные** APIs. Если ignored artifacts недоступны после интеграции, сохранить этот блок как `worktrees/r42-resource-probes/removal-boundary.mjs` в checkout с тем же read-only `dist` и выполнить точную команду выше:

```js
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'production';
const {JSDOM} = await import('jsdom');
const dom = new JSDOM('<!doctype html><body></body>', {url: 'http://localhost/'});
for (const name of ['window', 'document', 'navigator', 'HTMLElement']) {
    Object.defineProperty(globalThis, name, {value: dom.window[name], configurable: true});
}
const React = await import('react');
const {createRoot} = await import('react-dom/client');
const {flushSync} = await import('react-dom');
const {ResourceCache} = await import('../../dist/esm-prod/Carburetor/index.mjs');
const {useResourceValue} = await import('../../dist/esm-prod/Interop/index.mjs');
const drain = async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    flushSync(() => {});
    await new Promise(resolve => setTimeout(resolve, 20));
};
const results = [];
for (const action of ['forget', 'restore']) {
    for (const timing of ['before-loader', 'after-loader', 'before-loader-with-replacement']) {
        const requests = [];
        const cache = new ResourceCache(() => {
            const request = Promise.withResolvers();
            requests.push(request);
            return request.promise;
        }, {ttl: Infinity});
        const originalPromises = new Set();
        const caughtOriginals = [];
        const rawLoad = cache.load.bind(cache);
        cache.load = args => {
            const promise = rawLoad(args);
            originalPromises.add(promise);
            void promise.catch(error => { caughtOriginals.push(error.name); });
            return promise;
        };
        const unhandled = [];
        const observe = (reason, promise) => unhandled.push({name: reason.name,
            isOriginalLoadPromise: originalPromises.has(promise)});
        process.on('unhandledRejection', observe);
        const remove = () => {
            if (action === 'forget') cache.forget('x');
            else cache.restore({entries: {}});
        };
        let removed = false;
        const id = cache.subscribe(() => {
            if (timing === 'after-loader' || removed || cache.getEntry('x').status !== 'pending') return;
            removed = true;
            remove();
            if (timing === 'before-loader-with-replacement') void cache.load('x');
        }, {reads: new Set([cache.resolve('x').path])});
        let renders = 0;
        const select = view => view.data?.name;
        const Reader = ({tick}) => {
            renders++;
            return React.createElement('span', {title: String(tick)}, useResourceValue(cache, 'x', select) ?? 'loading');
        };
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        const mount = tick => flushSync(() => root.render(React.createElement(Reader, {tick})));
        mount(0);
        await drain();
        if (timing === 'after-loader') {
            assert.equal(requests.length, 1);
            remove();
            await drain();
        }
        const beforeRescue = {calls: requests.length, renders, text: container.textContent,
            present: cache.resolve('x').present, status: cache.getEntry('x').status};
        if (timing === 'before-loader') {
            assert.deepEqual(beforeRescue, {calls: 0, renders: 1, text: 'loading', present: false, status: 'idle'});
            assert.deepEqual(caughtOriginals, ['AbortError']);
            assert.deepEqual(unhandled, [{name: 'AbortError', isOriginalLoadPromise: false}]);
            mount(1);
            await drain();
            assert.equal(requests.length, 1);
        } else if (timing === 'after-loader') {
            assert.equal(requests.length, 2);
            assert.deepEqual(unhandled, []);
        } else {
            assert.equal(requests.length, 1);
            assert.deepEqual(unhandled, [{name: 'AbortError', isOriginalLoadPromise: false}]);
        }
        if (timing === 'after-loader') requests[0].resolve({name: 'retired'});
        requests.at(-1).resolve({name: 'ready'});
        await drain();
        assert.equal(container.textContent, 'ready');
        results.push({action, timing, beforeRescue, final: {calls: requests.length, text: container.textContent},
            caughtOriginals, unhandled});
        flushSync(() => root.unmount());
        cache.unsubscribe(id);
        container.remove();
        await drain();
        process.removeListener('unhandledRejection', observe);
    }
}
dom.window.close();
console.log(JSON.stringify({node: process.version, react: React.version,
    distribution: 'dist/esm-prod at fa1ad08f8cd6b26f175235a435976fcb9d94dd22', results}, null, 2));
```

Event listeners здесь — **instrumentation**, не исправление: они позволяют собрать actual global events, не остановив весь proof на первом expected cancellation. Они удаляются, roots unmount-ятся, JSDOM закрывается. Production/tests/compiled distribution не менялись.

## Ограничения evidence и hand-off

- Не выполнены build, typecheck, lint, formatter, unit/integration suites, full/focused benchmarks, heap/GC/CPU profiling, browser Chromium, packed consumers и remote CI. Нет A/B implementation, measured speedup или total byte claims.
- Runtime scope: production ESM, React 19.3.0/JSDOM; CJS/development, React 18, Suspense/SSR/hydration, StrictMode и arbitrary subclass hooks не исполнялись. Published SSR effect correction и R40/R41 fixes не объявлены новыми finding.
- В этом review фактически отменялись pre-loader initial requests через `abort`/`forget`/`restore`. Refresh, failed-retry, `forgetAll`, eviction-driven cancellation, unexpected custom-source rejection и teardown races — future adversarial matrix, не доказанное распространение bug на каждый маршрут.
- Для следующей реализации, **unverified здесь**, orchestrator может последовательно выполнить `npm test -- __tests__/Engine/Resource/ResourceCache`, `node perf/run.mjs --only resource40 --runs 3 --dist dist/esm-prod --verbose`, `node perf/run.mjs --only resource41 --runs 3 --dist dist/esm-prod --verbose`, затем установленную им общую verification policy. Retention child из `resource41/retention-live-cache` требует отдельного GC-enabled процесса; тяжёлых checks автор не запускал и здесь не запрашивает.
- Рекомендуемый порядок: совместно исправить terminal ownership **R42-R02** и missing-entry lifecycle token **R42-R01**, сохранив независимые acceptance. Не добавлять speculative caching/validation/retries и не менять selector API ради этих ошибок.

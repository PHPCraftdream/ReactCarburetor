# Раунд 43 — React API, source selection и lifecycle — 2026-10-11

> Примечание: машинно-зависимые пути нормализованы: `.` обозначает корень репозитория,
> `<temp>` — временный каталог. Остальные данные исторического отчёта сохранены.

- Reviewed base: **`90a1c6041c2d33d3e9d307a79856deb67a9a67db`**, завершённая реализация R42.
- Исполнитель: **xxs / R43ReactApi**.
- Изолированная ветка/worktree: `review-r43-react-api-20261011`.
- Scope: `lib/src/Carburetor/Component/`, `Interop/useCarburetorValue.ts`, `useComputedValue.ts`, consumer models/declarations, соответствующие callers/tests/manifests. Resource reader прочитан только как публичная caller/commit boundary; load/error machinery не исследовалась.
- Это **source review, не runtime verification**. Здесь не запускались Node probes, React renderer, GC, build, tests, lint, formatter, benchmark или browser. Production/tests/benchmarks/config/dependencies намеренно не изменены; единственный writable файл — этот отчёт.
- LSP недоступен: `read xd://lsp` ответил `No such tool`, доступны только устройства `ast_edit, debug`. Symbol/caller evidence получена `read`/`grep`.

## Результат и границы доказательств

**Два новых source-backed finding; runtime acceptance ещё должен исполнить parent.** Новых измеренных выигрышей в renders, latency, allocated bytes или instructions нет.

| ID | Приоритет и класс | Статически установленный механизм | Что ещё не доказано исполнением |
|---|---|---|---|
| **R43-A01** | **P2, retention / lifecycle** | Кэшированный class `useCarburetor` view оставляет сильные `attempt`/`entry` ссылки после закрытия render. При прекращении чтения живого source его последний attempt, включая obsolete props/state, остаётся в per-component WeakMap | Collectibility на реальном ReactDOM после удаления старых Fiber props; размер удержанного heap и цена исправления |
| **R43-A02** | **P3, React 18 SSR diagnostics / compatibility** | `useCarburetorValue` безусловно вызывает два `useLayoutEffect`, хотя соседний resource hook уже выбирает server `useEffect`. У ReactDOM 18.3.1 server dispatcher layout hook непосредственно выдаёт warning | Actual stderr на frozen bundles; SSR/hydration output и client commit invariants после будущего исправления |

R43-A01 — не повтор stale-DOM finding R42-A01: речь о времени жизни **raw class tracked view**, не о notification-time selection gate. R43-A02 — remaining **другой hook route**, а не повтор уже исправленного resource SSR route. В обоих случаях proposed fix не реализован.

Physical evidence: прочитаны исходники и supplied `dist` declarations/ESM counterpart, но модули не исполнялись. Parent сообщил immutable distributions `./worktrees/bench-dist/90a1c6041c2d/{esm,esm-prod,cjs,cjs-prod}` из already-built reviewed base и successful baseline smoke четырёх форматов; это **provenance от parent**, не проверки этого исполнителя. В recipes `DIST_ROOT` выбирает **одну format directory**; fallback argv выбирает `dist/<format>`.

## R43-A01 — transient render ownership остаётся в persistent tracked-view cache

### Достижимый consumer и сильный путь

Один mounted компонент переключает `this.props.source` между несколькими stores, которые остаются живы в scope/registry. В каждом render он делает `this.useCarburetor(this.props.source).n`; props дополнительно содержат caller-owned payload, не нужный store. После source swap прежняя subscription снимается, но прежний view не используется снова. Ещё более простой вариант — ветка перестаёт вызывать `useCarburetor` при `show=false`, а store и компонент остаются живы.

Точный путь в текущем source:

1. [`Reads.tsx:47–70`](../../lib/src/Carburetor/Component/AntiHookComponent/Reads.tsx#L47), `AntiHookComponentReads.useCarburetor`: instance держит `C.trackedViews`, `WeakMap<source, ITrackedView>`.
2. [`buildTrackedView.ts:39–56`](../../lib/src/Carburetor/Component/AntiHookComponent/buildTrackedView.ts#L39), `buildTrackedView`: cached record получает `attempt` и `entry`; новое значение WeakMap содержит те же ссылки, а persistent recorder читает их. Повторный вызов **того же source** обновляет ссылки; никакой release при прекращении чтения source здесь нет.
3. [`Foundation.tsx:310–336`](../../lib/src/Carburetor/Component/AntiHookComponent/Foundation.tsx#L310), `C.openRenderAttempt`/`C.closeRenderAttempt`: attempt содержит реальные `this.props` и `this.state`. Close оставляет pending identity и сбрасывает только `C.renderAttempt`.
4. [`Subscriptions.tsx:80–88,138–146`](../../lib/src/Carburetor/Component/AntiHookComponent/Subscriptions.tsx#L80), `C.commitSubscriptions`: retired tracked slot удаляется; `attempt.tracked/connections` очищаются, **не** `ITrackedView.attempt/entry`. [`:365–375`](../../lib/src/Carburetor/Component/AntiHookComponent/Subscriptions.tsx#L365), `C.releaseSubscriptions`, также не очищает эти поля.
5. [`Connection.ts:79–89,169–174`](../../lib/src/Carburetor/Component/Models/Connection.ts#L79) закрепляет именно strong fields, не WeakRefs.

Таким образом, при живых component **и key-source** сохраняется путь:

```text
component → trackedViews --(live source key)→ cached record → obsolete attempt → props/state → caller payload
```

WeakMap не ослабляет value, пока жив key. Subscription count 0 на старом source не опровергает этот путь. Кэширование proxy/data само по себе полезно; лишними здесь являются **уже закрытые attribution pointers**.

Для K живых retired sources и графов props/state размером P_i, [INFERENCE] возможно удержание суммы достижимых obsolete graphs, порядка Θ(Σ P_i), независимо от active subscription count. Общие узлы считаются один раз. Это не измеренные bytes и не утверждение, что весь class cache должен иметь размер O(1).

### Безопасное направление и риски

Развести lifetime persistent view и lifetime текущего recorder route: после закрытия соответствующего render record больше не должен сильно держать attempt/entry. Обнулять только matching transient route; pending/committed attempt и его entries, нужные commit/drift check, остаются у их существующего владельца. Это внутреннее исправление: удаление `useCarburetor`, принудительный remount или consumer migration не нужны.

Cleanup должен охватить и `finally` abandoned render: исключительно post-commit очистка не освобождает cancelled/suspended attempts. Не стирать `owner.props/state` у committed attempt — они нужны исправленному R42 selection gate. Не сбрасывать весь proxy cache при каждом commit: это вернёт allocation/identity churn и нарушит уже защищённую warm reuse.

Дополнительный implementation risk, **[INFERENCE], не отдельный finding**: `buildTrackedView` создаёт обе recorder closures в одной factory scope (`:31–36` и `:48–54`); одна из них лексически использует исходные `attempt/entry`. V8 context sharing может оставить initial context даже после очистки mutable record. При реализации использовать существующий boring принцип отдельной recorder factory, владеющей только стабильным accessor и mutable route, как [`Computed.ts:301–310`, `C.createReadRecorder`](../../lib/src/Carburetor/Derived/Computed.ts#L301). Именно **class** cached route проверяется здесь; исправленный R41 computed route не объявляется снова сломанным. Родитель должен также проверить repeated same-source renders, чтобы clearing pointers не оказалось лишь частичным fix.

Инварианты будущего fix:

- Старые props/state collectible при живых component/stores после нескольких последующих commits без этих payloads; caller-held current payload — live control.
- Root view identity/read-proxy reuse для unchanged data остаётся; повторное чтение retired source снова записывает правильные paths.
- Captured view read вне render остаётся inert; он не записывает в закрытый attempt и не расширяет новое владение чужого source.
- Source swap: DOM нового source, старые writes silent, новые observed writes delivered; unsubscribe/replay/re-arm сохраняются.
- Abandoned/self/child suspension, cancel/resume и StrictMode не публикуют tentative reads. Не pin-ить speculative render counts.

Уверенность: высокая в explicit strong-reference path; runtime collectibility и влияние shared closure context не проверены. Опровержение runtime finding: корректно очищенные control frames/Fiber alternates дают collectible retired raw payloads уже на текущем build. Если controls тоже удерживают payloads, сначала исправить probe или установить общий renderer root; это не доказательство library retention.

### Coverage gap и permanent family

`ReadableCarburetor.test.tsx:108–150` защищает active counts/DOM/source silence, но не lifetime старых props. `components/proxy-reads` защищает reuse **одного постоянно читаемого** store. `components/connect-retention@4k` измеряет connected mount shape/heap и не переключает raw `useCarburetor` sources. `computed41/observer-lifetime` проверяет другой владельческий слой.

Предлагаемая новая family `components43/tracked-route-lifetime@{1,4,8}` — отдельные GC processes, actual mounted DOM, strongly live retired stores, tiny payloads. Gates после fix: retired payloads collectible; empty GC control collectible; strong payload live; connect/hook controls collectible; current DOM/observed edit/source release корректны. Дополнить same-source initial-payload, branch-off, abandoned attempt lanes. Cheap control — несколько unchanged-data commits с zero proxy rebuild/registration churn; стоимость cleanup измерять отдельным **uninstrumented complete render+commit** A/B, не по WeakRef counts.

## R43-A02 — старый store hook не применяет существующий server commit-effect contract

### Механизм и область нарушения

- [`useCarburetorValue.ts:3,347–364`](../../lib/src/Interop/useCarburetorValue.ts#L347): оба commit reconciliations прямо используют `useLayoutEffect`, в том числе selection-примитив без copy ledger.
- [`useResourceValue.ts:3,13,44–48`](../../lib/src/Interop/useResourceValue.ts#L13): уже существующий `useCommitEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect` устраняет тот же server diagnostic на resource route, сохраняя client layout phase.
- [`README.md:810–836`](../../README.md#L810) называет hooks SSR-safe; [`package.json:74–76`](../../package.json#L74) поддерживает React 18 и 19.
- В реально доступном **прочитанном, но не исполненном** ReactDOM 18.3.1 `.consumer-matrix/react18-npm/node_modules/react-dom/cjs/react-dom-server-legacy.node.development.js:5159–5164,5261` `useLayoutEffect` вызывает `error('useLayoutEffect does nothing on the server...')`, а server `useEffect` — noop. React 19 server dispatcher использует noop и потому не является достаточным отрицательным control.

Достижимая операция: настоящий Node `renderToString(<Badge/>)` без DOM globals, где Badge использует `useCarburetorValue(store, data => data.n)`, при development React 18. Library production bundle не переключает ReactDOM на production renderer: diagnostics принадлежат consumer React.

Это **не** установленный hydration mismatch и не ошибка выбранного значения. Warning обещает mismatch, хотя данное effect здесь управляет подпиской/ownership, а не server HTML. P3 обусловлен диагностикой на поддержанной платформе и отсутствием доказанного data-loss/latency effect. [INFERENCE] warning work растёт с количеством SSR hook evaluations; counts, bytes и server throughput не измерены.

Применить к store hook тот же существующий server/client effect choice, не подавлять console, не делать `useEffect` безусловно на клиенте и не удалять wake-time `install()`. Новая абстракция или public flag не нужны; маленький общий internal helper допустим только если реально убирает дублирование существующей конвенции. Убедиться в раздельной загрузке server/client module graph: выбор по `typeof window` производится при import.

Уверенность: высокая в source/React18-dispatcher механизме, actual frozen-bundle stderr ещё не получен. Disproof control — positive layout component **должен** выдать diagnostic на React 18; если он silent, probe использовал не development renderer, не React 18 или другую React identity. React 19 silence не опровергает finding.

### Coverage gap и permanent acceptance

`scripts/consumer-matrix/cell.mjs:63–115,143–146` SSR-ит hook consumer и проверяет HTML/exit status, но не требует пустой stderr успешного smoke. Resource SSR child и `resource40/Lifecycle` уже проверяют настоящий Node SSR + clean stderr **resource** route. `components/ssr` SSR-ит classes, не store hooks.

Новая family/test `hooks43/store-ssr-commit-boundary`: actual Node React 18/19 development, prod/dev library formats; empty/class/computed/resource controls, positive layout control. После fix store layout diagnostics 0, server subscriptions 0, markup корректен. Затем fresh client import, hydration без recovery, unread write без committed update, observed write меняет DOM, source swap освобождает old subscription, write в child layout до owner commit не теряется. Timing здесь diagnostic only; никакого latency threshold из количества warnings.

## API и отклонённые кандидаты

1. **Исправленный R42-A01 не повторяется.** `Reads.tsx:199–203,225–228` проверяет pending/committed/snapshot attempt и props/state identity до scratch migration; `components42/checks.mjs:79–110` защищает реальный DOM, suspended ownership, cancel/resume, source swap и late callbacks. Эти tests здесь лишь прочитаны. Новая R43-A01 не предлагает ослаблять этот guard ради памяти.
2. **Stable warm subscription churn не найден по source.** Hook `install()` (`useCarburetorValue.ts:162–187`) и class `C.alignSubscription` (`Subscriptions.tsx:302–315`) не re-file content-equal reads и adopt filed identity. `components42/checks.mjs:164–184` уже имеет warm/equal-migration controls. Новых runtime zero-allocation claims нет.
3. **Inline selector/class per-call selection — известный контракт.** Hook cache validity включает source, selector и comparator (`:221–248`); class selector читает props/state на каждом вызове (`Reads.tsx:164–167,263–265`). R42 report уже отклонил повторные notification/render selector calls как новый finding. Callback/dependency-array arguments и class attempt/Set bookkeeping видны в source, но это не measured bottleneck; pooling открытых/closed reads опасен.
4. **`useComputedValue` не заменять store hook автоматически.** Это `IComputed<R>.get()` + versioned envelope (`useComputedValue.ts:13–29,38–50`) и live `R`, а store route требует `IReadableCarburetor<T>.read(record)` и возвращает detached `TReadonly<R>`. `Models/Derived.ts:5–7`, `Models/Store.ts:79–87`, опубликованные `dist/esm/Interop/*.d.mts` различают capabilities/ownership. Удаление одного adapter изменит consumer contract, не упростит эквивалентный путь бесплатно.
5. **Не откатывать R41 resource selector cutover.** Обязательный synchronous selector, closed capture reads и detached memo-child result приняты в R41 Resolution; `Interop/Models.ts` re-export-ит общий `TSelector`, comparator принимает readonly значения. Published fixture `consumer.tsx:150–157,206–227`, class/readable ownership type fixtures проверяют реальные consumer shapes. Implicit whole-resource default, writable hook facade и новый raw hook не предлагаются.
6. **Live class `connect` и `useCarburetor` не удалять ради API унификации.** `connectSelection` нужен для detached memo children; raw render-local view и persistent field declaration имеют другие lifetime/source-resolution contracts. Scoped array-root fallback и opaque-root cost уже документированы, не новая находка.
7. **Scope/provider, cleanup failures и dual install effects не объявляются новым perf выигрышем.** Mutable `scope.set` не обещает React notification; failure isolation имеет свои tests. Wake-time install требуется для equal-valued read migration без React commit. Удаление «лишнего» reconciliation ради меньшего числа вызовов может потерять подписку. R42 noisy timing flags не используются как новый evidence.

Безопасное API направление: сохранить текущие три consumer shapes — render-local live class view, detached selection и live computed publication. Для memo-child transfers выбирать существующий `connectSelection`/selector hook; hoist или `useCallback` только selectors, действительно зависящие от указанного caller input. R43-A01/A02 требуют внутренних lifetime/effect исправлений, **не** breaking migration. Если отдельный API cutover всё-таки предложен позже, сначала доказать equivalent DOM/ownership и обновить published React 18/19 declarations, все callers и существующие R41 tests; compatibility shim не нужен.

## Parent recipes — не исполнены агентом

Сохранить snippets в ignored `worktrees/` **внутри assigned worktree**. Файлы ниже агент не создавал. Все commands — для parent, последовательно; code не переписывает supplied bundles. Loader следует существующей `resource42/fixture.mjs` convention: ESM `index.mjs`, CJS `index.js`, никогда `index.cjs`.

### Recipe A01: `worktrees/r43-a01-lifetime.mjs`

Production React исключает dev Fiber/debug retention как обязательное условие первого сравнения. Четыре stores на lane, payload по восемь small records; никакого искусственного memory pressure. GC controls обязательны; deref только после всех job/GC turns. Default asserts воспроизводят **ожидаемое по source** current retention; после будущего fix `EXPECT_RELEASE=1` меняет acceptance на collectibility.

```js
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
process.env.NODE_ENV = 'production';
assert.equal(typeof globalThis.gc, 'function', 'run with --expose-gc');
const require = createRequire(resolve('package.json'));
const {JSDOM} = require('jsdom');
const dom = new JSDOM('<!doctype html><body></body>', {url: 'http://localhost/'});
for (const key of ['window', 'document', 'HTMLElement', 'Node']) globalThis[key] = dom.window[key];
const React = require('react');
const {createRoot} = require('react-dom/client');
const {flushSync} = require('react-dom');
const bundle = resolve(process.env.DIST_ROOT ?? `dist/${process.argv[2] ?? 'esm-prod'}`);
const esm = existsSync(resolve(bundle, 'Carburetor/index.mjs'));
assert.ok(esm || existsSync(resolve(bundle, 'Carburetor/index.js')), 'actual bundle entry');
const load = part => esm ? import(pathToFileURL(resolve(bundle, part, 'index.mjs')).href)
    : Promise.resolve(require(resolve(bundle, part, 'index.js')));
const {Carburetor, AntiHookComponent} = await load('Carburetor');
const {useCarburetorValue} = await load('Interop');
const h = React.createElement;
const pick = data => data.n;
const payload = id => ({id, rows: Array.from({length: 8}, (_, n) => ({n}))});
class Store extends Carburetor {
    active = new Set(); adds = 0; removes = 0; readCalls = 0;
    edit(fn) { this.update(fn); }
    read(record) { this.readCalls++; return super.read(record); }
    subscribe(fn, options) {
        const id = super.subscribe(fn, options); this.active.add(id); this.adds++; return id;
    }
    unsubscribe(id) { this.active.delete(id); this.removes++; super.unsubscribe(id); }
}
function prepare(kind) {
    const stores = Array.from({length: 4}, (_, n) => new Store({n, unread: 0}));
    const current = new Store({n: 100, unread: 0});
    const refs = [];
    let commits = 0;
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    class Raw extends AntiHookComponent {
        componentDidMount() { super.componentDidMount(); commits++; }
        componentDidUpdate(prev) { super.componentDidUpdate(prev); commits++; }
        render() { return h('p', null, this.useCarburetor(this.props.source).n); }
    }
    class Connected extends AntiHookComponent {
        view = this.connect(() => this.props.source);
        componentDidMount() { super.componentDidMount(); commits++; }
        componentDidUpdate(prev) { super.componentDidUpdate(prev); commits++; }
        render() { return h('p', null, this.view.n); }
    }
    function Hook({source}) {
        const n = useCarburetorValue(source, pick);
        React.useLayoutEffect(() => { commits++; });
        return h('p', null, n);
    }
    const Component = kind === 'raw' ? Raw : kind === 'connect' ? Connected : Hook;
    const render = (source, marker, tick) => flushSync(() => root.render(h(Component, {source, marker, tick})));
    // A returned synchronous frame owns each marker only until its real commit.
    const visit = (source, tick) => {
        const marker = payload(tick); refs.push(new WeakRef(marker)); render(source, marker, tick);
        assert.equal(container.textContent, String(source.getData().n));
    };
    for (let i = 0; i < stores.length; i++) visit(stores[i], i);
    for (let tick = 10; tick < 14; tick++) render(current, null, tick);
    assert.equal(container.textContent, '100');
    assert.ok(stores.every(store => store.active.size === 0));
    assert.equal(current.active.size, 1);
    const beforeWarm = [current.adds, current.removes, current.readCalls];
    render(current, null, 14); render(current, null, 15);
    assert.deepEqual([current.adds, current.removes, current.readCalls], beforeWarm, 'cheap warm reuse');
    const beforeQuiet = commits;
    flushSync(() => stores[0].edit(data => { data.n = 77; }));
    flushSync(() => current.edit(data => { data.unread++; }));
    assert.equal(container.textContent, '100');
    assert.equal(commits, beforeQuiet, 'retired/unread writes must not commit an update');
    flushSync(() => current.edit(data => { data.n = 101; }));
    assert.equal(container.textContent, '101');
    assert.ok(commits > beforeQuiet, 'observed update must actually commit');
    return {kind, refs, stores, current, root, container};
}
function releasedControl() { return new WeakRef(payload('empty')); }
const held = payload('strong');
const strong = new WeakRef(held);
const empty = releasedControl();
const lanes = ['raw', 'connect', 'hook'].map(prepare);
const turn = () => new Promise(resolve => setImmediate(resolve));
try {
    for (let i = 0; i < 16; i++) { await turn(); globalThis.gc(); }
    await turn();
    assert.equal(empty.deref(), undefined, 'empty GC/frame control must collect');
    assert.equal(strong.deref(), held, 'strong control must survive');
    const result = lanes.map(lane => ({kind: lane.kind,
        retained: lane.refs.filter(ref => ref.deref() !== undefined).length}));
    assert.equal(result[1].retained, 0, 'connect control must collect obsolete props');
    assert.equal(result[2].retained, 0, 'hook control must collect obsolete props');
    assert.equal(result[0].retained, process.env.EXPECT_RELEASE === '1' ? 0 : 4,
        'raw tracked route retention / future release acceptance');
    for (const lane of lanes) {
        assert.equal(lane.container.textContent, '101', 'owner remains mounted');
        assert.equal(lane.current.active.size, 1);
        assert.ok(lane.stores.every(store => store.active.size === 0), 'stores remain live but retired');
    }
    console.log(JSON.stringify({bundle, react: React.version, result, emptyCollected: true, strongAlive: true}));
} finally {
    for (const lane of lanes) {
        flushSync(() => lane.root.unmount());
        assert.equal(lane.current.active.size, 0, 'actual teardown'); lane.container.remove();
    }
    dom.window.close();
}
```

PowerShell, cwd assigned worktree:

```powershell
$env:DIST_ROOT = './worktrees/bench-dist/90a1c6041c2d/esm-prod'
node --expose-gc worktrees/r43-a01-lifetime.mjs esm-prod
$env:DIST_ROOT = './worktrees/bench-dist/90a1c6041c2d/esm'
node --expose-gc worktrees/r43-a01-lifetime.mjs esm
```

Если raw count меньше ожидаемого, не считать finding подтверждённым по предположению. Если любой collectible control не проходит, снять retention paths **до** `WeakRef.deref()` и устранить harness root. Единицы output — живые targets, не bytes. После будущего fix parent дополнительно запускает тот же recipe с `EXPECT_RELEASE=1` и существующие proxy/ownership gates без изменения thresholds.

### Recipe A02: `worktrees/r43-a02-ssr.mjs`

`REACT_ROOT` — project с выбранной consumer React installation. Для React 18 уже обнаружен `./.consumer-matrix/react18-npm`. Нельзя просто require-ить React 18 рядом с original bundle, который разрешит React 19: snippet делает **собственные disposable copies** выбранного immutable format и junction к выбранным dependencies. Server import идёт без DOM globals, client — из второй copy после появления DOM. Исходный `DIST_ROOT` никогда не меняется; cleanup сперва удаляет только собственную junction. Console diagnostics записываются **и передаются оригинальному console.error**, не подавляются.

```js
import assert from 'node:assert/strict';
import {cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync,
    rmSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
process.env.NODE_ENV = 'development';
assert.equal(typeof globalThis.window, 'undefined', 'SSR must begin in real Node, without DOM');
const repoRequire = createRequire(resolve('package.json'));
const reactRoot = resolve(process.env.REACT_ROOT ?? '.');
const require = createRequire(resolve(reactRoot, 'package.json'));
const React = require('react');
const {renderToString} = require('react-dom/server');
const h = React.createElement;
const dist = resolve(process.env.DIST_ROOT ?? `dist/${process.argv[2] ?? 'esm-prod'}`);
const esm = existsSync(resolve(dist, 'Carburetor/index.mjs'));
assert.ok(esm || existsSync(resolve(dist, 'Carburetor/index.js')), 'actual bundle entry');
mkdirSync('worktrees', {recursive: true});
const temporary = mkdtempSync(resolve('worktrees/r43-a02-'));
const link = resolve(temporary, 'node_modules');
symlinkSync(realpathSync(resolve(reactRoot, 'node_modules')), link, 'junction');
const copy = name => {
    const dir = resolve(temporary, name); cpSync(dist, dir, {recursive: true});
    writeFileSync(resolve(dir, 'package.json'), JSON.stringify({type: esm ? 'module' : 'commonjs'}));
    return dir;
};
const load = (dir, part) => esm ? import(pathToFileURL(resolve(dir, part, 'index.mjs')).href)
    : Promise.resolve(require(resolve(dir, part, 'index.js')));
function countedStore(Base) {
    return class extends Base {
        active = new Set(); adds = 0;
        edit(fn) { this.update(fn); }
        subscribe(fn, options) {
            const id = super.subscribe(fn, options); this.adds++; this.active.add(id); return id;
        }
        unsubscribe(id) { this.active.delete(id); super.unsubscribe(id); }
    };
}
function capture(Component) {
    const errors = []; const original = console.error;
    console.error = (...args) => { errors.push(args.map(String).join(' ')); original(...args); };
    try { return {html: renderToString(h(Component)), errors}; }
    finally { console.error = original; }
}
let dom, root;
const act = React.act ?? require('react-dom/test-utils').act;
try {
    const serverDir = copy('server');
    const api = await load(serverDir, 'Carburetor');
    const interop = await load(serverDir, 'Interop');
    const Store = countedStore(api.Carburetor);
    const server = new Store({n: 7, unread: 0});
    const derived = api.computed(read => read(server).n);
    const cache = new api.ResourceCache(async () => ({n: 7}), {ttl: Infinity});
    await cache.load('x');
    let cacheAdds = 0;
    const subscribe = cache.subscribe;
    cache.subscribe = (...args) => { cacheAdds++; return subscribe.apply(cache, args); };
    class ClassControl extends api.AntiHookComponent {
        render() { return h('p', null, this.useCarburetor(server).n); }
    }
    const pick = data => data.n;
    function StoreHook() { return h('p', null, interop.useCarburetorValue(server, pick)); }
    function ComputedControl() { return h('p', null, interop.useComputedValue(derived)); }
    function ResourceControl() {
        return h('p', null, interop.useResourceValue(cache, 'x', view => view.data.n));
    }
    function Empty() { return h('p', null, 7); }
    function LayoutPositive() { React.useLayoutEffect(() => {}); return h('p', null, 7); }
    const results = Object.fromEntries(Object.entries({empty: Empty, class: ClassControl,
        computed: ComputedControl, resource: ResourceControl, store: StoreHook,
        layoutPositive: LayoutPositive}).map(([name, Component]) => [name, capture(Component)]));
    const warnings = Object.fromEntries(Object.entries(results).map(([name, result]) => [name,
        result.errors.filter(text => text.includes('useLayoutEffect does nothing on the server')).length]));
    for (const result of Object.values(results)) assert.equal(result.html, '<p>7</p>', 'actual selected SSR output');
    for (const name of ['empty', 'class', 'computed', 'resource']) assert.equal(warnings[name], 0, name);
    assert.equal(server.adds, 0, 'SSR must never attach a store subscription');
    assert.equal(cacheAdds, 0, 'resource SSR control must never attach');
    if (React.version.startsWith('18.')) {
        assert.ok(warnings.layoutPositive > 0, 'React 18 diagnostic detector positive control');
        if (process.env.EXPECT_CLEAN === '1') assert.equal(warnings.store, 0);
        else assert.ok(warnings.store > 0, 'current remaining store-hook SSR route');
    } else {
        assert.equal(warnings.layoutPositive, 0, 'React 19 dispatcher control');
        assert.equal(warnings.store, 0);
    }
    const {JSDOM} = repoRequire('jsdom');
    dom = new JSDOM('<!doctype html><body><div id="root">' + results.store.html + '</div></body>',
        {url: 'http://localhost/'});
    for (const key of ['window', 'document', 'HTMLElement', 'Node']) globalThis[key] = dom.window[key];
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const clientDir = copy('client');
    const clientApi = await load(clientDir, 'Carburetor');
    const {useCarburetorValue} = await load(clientDir, 'Interop');
    const ClientStore = countedStore(clientApi.Carburetor);
    const first = new ClientStore({n: 7, unread: 0});
    const second = new ClientStore({n: 9, unread: 0});
    let commits = 0;
    function Writer({source}) {
        React.useLayoutEffect(() => { source.edit(data => { data.n = 8; }); }, [source]);
        return null;
    }
    function Client({source, gap = false}) {
        const n = useCarburetorValue(source, pick);
        React.useLayoutEffect(() => { commits++; });
        return h(React.Fragment, null, h('p', null, n), gap ? h(Writer, {source}) : null);
    }
    const container = document.getElementById('root');
    const errors = [];
    const {hydrateRoot} = require('react-dom/client');
    const gap = process.env.GAP === '1';
    await act(async () => { root = hydrateRoot(container, h(Client, {source: first, gap}),
        {onRecoverableError: error => errors.push(error)}); });
    assert.equal(container.textContent, gap ? '8' : '7', 'hydration / child-layout write must deliver');
    assert.equal(first.active.size, 1);
    const quiet = commits;
    await act(async () => first.edit(data => { data.unread++; }));
    assert.equal(commits, quiet, 'unread write must not commit an update');
    await act(async () => first.edit(data => { data.n = 11; }));
    assert.equal(container.textContent, '11', 'observed hydrated update');
    assert.ok(commits > quiet, 'actual observed commit');
    await act(async () => root.render(h(Client, {source: second})));
    assert.equal(container.textContent, '9', 'source swap commits new output');
    assert.equal(first.active.size, 0); assert.equal(second.active.size, 1);
    const afterSwap = commits;
    await act(async () => first.edit(data => { data.n = 50; }));
    assert.equal(container.textContent, '9'); assert.equal(commits, afterSwap, 'old source must stay silent');
    await act(async () => second.edit(data => { data.n = 10; }));
    assert.equal(container.textContent, '10'); assert.deepEqual(errors, [], 'no hydration recovery');
    await act(async () => root.unmount()); root = undefined;
    assert.equal(first.active.size + second.active.size, 0, 'actual teardown');
    console.log(JSON.stringify({dist, react: React.version, warnings, gap, hydrationRecovery: errors.length}));
} finally {
    if (root) await act(async () => root.unmount());
    dom?.window.close();
    unlinkSync(link); // Own junction only; remove it before recursive deletion.
    rmSync(temporary, {recursive: true, force: true});
}
```

PowerShell, cwd assigned worktree; каждый command — отдельный Node process:

```powershell
$env:REACT_ROOT = './.consumer-matrix/react18-npm'
$env:DIST_ROOT = './worktrees/bench-dist/90a1c6041c2d/esm-prod'
node worktrees/r43-a02-ssr.mjs esm-prod
$env:DIST_ROOT = './worktrees/bench-dist/90a1c6041c2d/esm'
node worktrees/r43-a02-ssr.mjs esm
$env:GAP = '1'
node worktrees/r43-a02-ssr.mjs esm
Remove-Item Env:GAP
$env:REACT_ROOT = './worktrees/review-r43-react-api-20261011'
node worktrees/r43-a02-ssr.mjs esm
```

Повторить с выбранным `cjs-prod`/`cjs` `DIST_ROOT` при необходимости; suffix автоматически `index.js`. Прочитанный consumer React18 installation может быть удалён parent cleanup — тогда parent использует существующий эквивалентный installed consumer cell, не смешивает React identities. После fix React18 запускается с `EXPECT_CLEAN=1`; positive layout control остаётся noisy. Никаких actual stdout/stderr результатов этих commands в отчёте нет.

## Порядок parent verification и raw-source citations

1. На immutable base последовательно исполнить A01 `esm-prod`, затем `esm`: controls, реальный DOM/commits и raw collectibility. При подозрительном результате снять root path до deref, не повышать memory pressure.
2. Исполнить A02 React18 `esm-prod`/`esm`, затем `GAP=1`; React19 — independent dispatcher control. Сохранить raw forwarded stderr, selected markup, subscription balance, hydration recovery. Только после этого объявлять runtime подтверждение.
3. При будущей реализации A01 сначала lifetime fix с intact R42 committed ownership; A02 — existing isomorphic commit-effect convention. Проверить React18/19, abandoned/cancel/resume/StrictMode, source swap и same-source initial-marker retention. Для material performance claims — отдельный uninstrumented whole-operation A/B с cheap controls, а не из counts.
4. Parent сохраняет существующие type tests, published consumer shapes, `components/proxy-reads`, `components/branch-migration@1`, `components42/selection-commit-ownership`, `hooks/r33-snapshot@10k`, hook default-comparator/source-swap tests и resource41 SSR contract. Новые proposed families дополняют coverage; старые manifests/thresholds не переписываются. Никаких новых запусков agent не выполнял.

Основные raw anchors текущей базы:

- `lib/src/Carburetor/Component/AntiHookComponent/{Reads.tsx:47–70,164–167,199–228,263–265; Foundation.tsx:273–300,310–336; Subscriptions.tsx:80–88,138–146,302–315,365–375}`.
- `lib/src/Carburetor/Component/AntiHookComponent/buildTrackedView.ts:22–58`; `Component/Models/Connection.ts:79–89,169–194`.
- `lib/src/Interop/{useCarburetorValue.ts:155–218,221–248,347–364; useComputedValue.ts:13–50; useResourceValue.ts:13,24–49; Models.ts:1–8}`.
- `lib/src/Carburetor/Models/{Store.ts:13,56–61,79–87; Derived.ts:5–7}`; published `dist/esm/Interop/{useCarburetorValue.d.mts:30; useComputedValue.d.mts:3–8}` — прочитаны, не typechecked.
- `__tests__/Engine/Derived/Readable/{ReadableCarburetor.test.tsx:108–150; selection-ownership.types.ts:67–94}`; `__tests__/Engine/Component/AntiHookComponent.types.test.ts:35–105`.
- `scripts/consumer-fixture/consumer.tsx:150–157,206–227`; `scripts/consumer-matrix/cell.mjs:63–115,143–146`; `scripts/consumer-matrix/round41/resourceSsr.mjs:1–28`.
- `perf/scenarios/components/{proxy-reads.mjs:27–67; ssr.mjs:25–41; pg/d1/connect-retention.mjs:7–30}`; `perf/scenarios/components42/checks.mjs:79–110,164–184`; `perf/gates/components42.mjs:1–15`.
- Novelty: [R42 Resolution](api-engine-review-round-42-2026-10-10.md#resolution--2026-10-11), [R42 React rejected candidates](api-engine-review-round-42-react-api-2026-10-10.md#не-новые-findings), [R41 accepted selector API / SSR follow-up](api-engine-review-round-41-2026-10-09.md#принятый-контракт-api).

## Parent verification — 2026-10-11

Parent лично исполнил A01 на **esm-prod/esm**, A02 React18 на **всех четырёх formats**
и отдельно child-layout gap, React19 control на **esm-prod/esm**: 9 serial Node processes.
Author execution limits выше остаются историей source-review phase; этот раздел добавлен
parent при squash. Production/fixes не менялись.

| Наблюдение | Actual result |
|---|---|
| A01 production React19, 4 strongly live retired sources | Raw retains 4 obsolete props targets; connect/hook controls retain 0 |
| A01 controls | Empty collectible; strong payload live; warm read/registration reuse, retired/unread precision, current DOM 101 и actual teardown проходят |
| A02 React18.3.1 server | Store hook 2 layout warnings, intentional layout positive 1; empty/class/computed/resource 0 |
| A02 client/SSR invariants | Correct selected HTML, server subscriptions 0; hydration recovery 0; observed/unread writes, source swap, old-source silence и release проходят |
| A02 child-layout gap | Actual post-hydration output 8; write не потерян |
| A02 React19.3.0 independent dispatcher | Store/layout-positive diagnostics 0; hydration controls проходят |

Server diagnostics перехватывались **и forwarded** original console, не подавлялись.
Development two-copy diagnostics при separate server/client fixture imports сохранены.
A01 — controlled Node/JSDOM collectibility, не Chromium heap/bytes measurement и не
unbounded leak claim.

Parent также проверил shared numeric-selection defect R43-S01 в **actual Chromium**:
при raw source `-Infinity` graph hook/class selection показывают stale `Infinity`,
scalar hook/raw class — `-Infinity`; finite control reaches `0.5` во всех lanes, browser errors 0.
Это отдельный content-gate mechanism, не повтор R42 ownership.

Raw receipts: `.rush/stdin/r43-ui-selection-probes.json`, `r43-browser-receipt.json`.
Scope/provenance и дальнейший acceptance: [общий R43 отчёт](api-engine-review-round-43-2026-10-11.md).

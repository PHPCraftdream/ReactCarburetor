# Раунд 44 — React API, адаптеры и время жизни — 2026-10-12

## База, объём и способ проверки

- Reviewed base: **`acfd3e2b8e58210ce1076bf1683f666283216af5`**.
- Исполнитель: **xxs / R44ReactApi**. Это review-only; production, tests, configurations, dependencies и версии не изменялись. Единственный создаваемый файл — этот отчёт; commits/push и дальнейшее делегирование не выполнялись.
- Scope: `lib/src/Interop/**`, `lib/src/Carburetor/Component/**`, публичные `Models/{Base,Store,Derived,Resource}` и exports; соответствующие class/hook fixtures, demo и packed-consumer callers. Computed implementation прочитана только для разграничения владельцев результата и snapshot revision, не как самостоятельное исследование derived engine.
- Сначала прочитаны [R43 React API](api-engine-review-round-43-react-api-2026-10-11.md) и [R43 Resolution](api-engine-review-round-43-2026-10-11.md#resolution-реализация-r43). Также учтены принятые R41/R42 cutovers и resolutions. Все десять R43 fixes считаются реализованными; повторных findings по ним здесь нет.
- LSP проверен непосредственно: `read xd://lsp` вернул `No such tool`, mounted devices — `ast_edit, debug`. Code intelligence выполнена через `read`/`grep`, без обещания полной LSP reference graph.
- Исполнены **два последовательных bounded real-API probes**, каждый в отдельном Node process; React **19.3.0 production**, Node **v24.12.0**, frozen **ESM-production**. DOM probe использует настоящий ReactDOM `createRoot`/`flushSync` и jsdom; SSR probe — настоящий Node `react-dom/server.renderToString` без DOM globals. В каждом — небольшие targets, 16 GC job turns на фазу, без allocation pressure, CPU pressure, аппаратной трассировки или UAC.
- Frozen distribution предоставлена parent: `worktrees/bench-dist/acfd3e2b8e58/esm-prod`. Receipt `.rush/stdin/r44-base-build.json` указывает точную базу и production entry SHA256 `a21d29ea69b7a6f9f6da09b785fda2e5e1798fa4767caa473971baaf562104da`. Это **provenance из receipt**, не самостоятельно переснятый checksum. Старые `90a1c`/`fa1ad` bundles не исполнялись.
- Build, typecheck, lint, test suites, formatters, existing benchmark suites и browser не запускались. Новых измерений latency, allocated bytes, heap-size delta или instructions нет. Collectibility и operation counts не выдаются за такие измерения.

## Результат

**Два новых подтверждённых lifetime finding. Доказанного нового extra-render, subscription-churn или public-cutover finding нет.**

| ID | Приоритет | Достижимый путь | Наблюдение на текущей базе |
|---|---|---|---|
| **R44-A01** | **P2 — retention, class selection attribution** | Живой class owner перестаёт вызывать ранее прочитанные `connectSelection()` declarations | Четыре obsolete props targets остаются живы при `active=0`, DOM `off`; raw `useCarburetor` и `connect` controls — 0. Повторное чтение всех selections освобождает targets |
| **R44-A02** | **P2 — retention, computed-hook snapshot cache** | `useComputedValue()` читает source; затем source остаётся жив, вычисляет новый объект вне hook, а hook больше его не читает | SSR с hook удерживает obsolete result subtree и для native `computed`, и для внешнего `IComputed`; no-hook controls — collectible. Повторный SSR hook read нового значения освобождает old targets |

Приоритет означает устранимое владение obsolete graph, а не доказанную большую heap утечку или падение FPS. Для A01 измерены только props targets; retained selection/data-cache graphs в этот результат не включаются. Для A02 один старый result на source — не история всех публикаций.

## R44-A01 — `connectSelection` сохраняет obsolete props через закрытую snapshot-attempt ссылку

### Consumer, якоря и механизм

Поддержанный caller: class с несколькими заранее объявленными selections для вкладок/секций. В render вызывается только текущая selection; после закрытия секции owner остаётся mounted. Дополнительный props payload уже не нужен ни store, ни scalar selected value. Это тот же разрешённый conditional pattern, который существующий fixture проверяет в [`child-props/prop-escape-safety.test.tsx:5–42`](../../__tests__/Engine/Component/AntiHookComponent/child-props/prop-escape-safety.test.tsx#L5), но fixture проверяет subscribers/DOM, не obsolete props lifetime. Достаточно и **одной** selection, которую перестают читать; четыре declarations в probe показывают независимые obsolete attempts.

Source anchors:

1. [`Reads.tsx:179–180,195–198,259–261`](../../lib/src/Carburetor/Component/AntiHookComponent/Reads.tsx#L179), `AntiHookComponentReads.connectSelection`: factory создаёт closure-owned `snapshotAttempt`, возвращённый callable присваивает ему **сам `IRenderAttempt`**, а notification gate проверяет его identity против committed owner.
2. [`Foundation.tsx:314–322`](../../lib/src/Carburetor/Component/AntiHookComponent/Foundation.tsx#L314), `C.openRenderAttempt`: attempt содержит реальные `props`/`state`, не только identity token.
3. [`Subscriptions.tsx:91–105,138–145`](../../lib/src/Carburetor/Component/AntiHookComponent/Subscriptions.tsx#L91), `C.commitSubscriptions`: unread fresh commit очищает `connection.committed`, `attemptTag`, `attemptSource`, `attemptEntry`; прежние attempt maps удаляются. **Closure-owned `snapshotAttempt` не очищается.**
4. [`Foundation.tsx:338–350`](../../lib/src/Carburetor/Component/AntiHookComponent/Foundation.tsx#L338), R43-A01 cleanup касается `trackedViews` raw route; selection closure туда не входит. Frozen ESM `Reads.mjs:62,71,101` сохраняет тот же механизм.
5. [`Connection.ts:94–100,169–172`](../../lib/src/Carburetor/Component/Models/Connection.ts#L94) разделяет persistent declaration и attempt configuration. Declaration должна оставаться reusable, но это не требует сильного владения всеми её obsolete props.

```text
mounted owner → selection callable / connection.wake closure
              → snapshotAttempt → obsolete props/state → caller payload
```

В probe selector возвращает **primitive `data.n`**, а payload не участвует в selection. Поэтому сохранение detached selection identity не объясняет владение payload. Источники также живы, но props target отсутствует в их state.

**Это не повтор R43-A01:** repaired raw cached-view route в том же реальном DOM probe собирает все obsolete targets. Новый owner — closure выбранного adapter `connectSelection`, и другой lifetime boundary — прекращение вызова persistent selection. **Это не повтор R42-A01:** stale DOM/read migration не обнаружены; identity guard корректности обязателен и не предлагается удалить.

### Наблюдение и controls

Probe A01, полный source ниже:

- K=4; после четырёх real reads выполнены шесть свежих hidden commits с `marker=null` для turnover renderer props.
- После GC `raw=0`, `connect=0`, **`selection=4`** obsolete targets. Все lanes mounted, DOM `off`, суммарные active subscriptions **0**.
- Empty GC/frame control collectible; caller-held strong target жив.
- Hidden-source writes не увеличивают **actual class commit count** и не меняют DOM. Это не вывод о renders из количества notifications.
- После re-arm всех selections DOM соответствует изменённому source `77`; unread write не коммитит update; observed write даёт DOM **`78`**. Warm parent commits не увеличивают `store.read`/subscribe/unsubscribe counters.
- После re-arm и нового hidden turnover все lanes имеют **0** retained obsolete targets; teardown оставляет active subscriptions 0.

Высокая уверенность в explicit strong path и observable collectibility difference. Private-field mutation/sensitivity variant не исполнялась. Production React исключает обязательную для первого контроля dev-debug retention, а raw/connect lanes проверяют общий renderer/frame ownership.

[INFERENCE] Для K stopped declarations сохраняются до K различных obsolete attempts и достижимые из них props/state graphs: O(K) metadata, размер retained reachable graph определяется объединением этих graphs, а не размером selection. Общие узлы не считаются дважды. Ни bytes, ни длительность удержания в реальном приложении не измерены.

### Консервативное направление и риски

Развести **identity needed by selection wake guard** и **strong configuration ownership**. Самое узкое направление — освобождать selection-only strong attribution, когда свежий committed attempt окончательно перестал читать declaration, либо хранить identity без backlink к obsolete props/state. Не стирать committed owner's props/state; не подменять guard сравнением values и не сравнивать against speculative configuration.

Конкретный internal дизайн должен учитывать abandoned/suspended reads, minifier closure sharing и replay. Например, новая identity-only metadata сама имеет allocation cost; weak attribution требует проверки supported runtimes и snapshot ownership. Это направления, не реализованные и не измеренные оптимизации. Нельзя объявлять cleanup реализованным только потому, что subscription стала 0.

Не очищать весь persistent view/selection cache на каждый render ради этого одного поля: это создаст copying/identity churn и лишит memo-child поддержанного bailout. Не удалять public `connectSelection`, не требовать consumer remount/ручной dispose. Не распространить selection equality gate на raw class `connect`/`useCarburetor`: у них **path-wake**, не selected-value gate.

### Предлагаемый permanent acceptance

Новая bounded family `components44/selection-attribution-lifetime@{1,4,8}`:

1. При alive owners/sources stopped scalar selections освобождают obsolete props targets; raw/connect и empty controls collectible; strong current/caller payload остаётся жив.
2. Re-arm показывает latest source, active handle 1, observed update виден; stopped/retired/unread writes не дают real commit. Warm selection snapshot identity и registration reuse сохранены.
3. Варианты props и state payload, source swap, self/child Suspense: speculative source не подписывается; cancel/resume не переносит reads с видимой ветки; после definitive unread commit obsolete speculative attribution collectible. Не pin-ить speculative render counts.
4. Сохранить existing R42 `components42/selection-commit-ownership`, StrictMode replay/hide/reveal и render→commit write-gap controls; replay без свежего attempt не должен стирать committed dependency descriptions.
5. Cleanup cost сравнить по полному uninstrumented render+commit A/B отдельно от GC probe. Здесь нет оснований для заданного percent/byte/time gain.

## R44-A02 — module-wide computed snapshot держит старый результат дольше source evaluation

### Consumer, якоря и механизм

Поддержанный `IComputed<R>` может жить в scope/registry дольше hook subtree. После исчезновения subtree другой consumer продолжает читать тот же computed и получает новый object result. SSR — ещё более чистый reachable surface: renderer не устанавливает subscriptions/effects, однако выполненный hook оставляет запись в module cache. Probe использует **один Node process, настоящие последовательные server renders, native computed и публичную внешнюю реализацию**, без singleton cross-user-state сценария. Для source, который сам уже заменил result, cache продолжает владеть старым graph независимо от React tree.

Anchors:

- [`useComputedValue.ts:7–29`](../../lib/src/Interop/useComputedValue.ts#L7), `snapshots` / `readSnapshot`: module-wide `WeakMap<IComputed, IComputedSnapshot>` хранит **strong `value`**. Weak key не ослабляет value, пока source жив. Запись меняется только при следующем `readSnapshot` этого source.
- [`useComputedValue.ts:38–50`](../../lib/src/Interop/useComputedValue.ts#L38): disposer лишь `computed.unsubscribe(id)`; SSR никаких disposers не получает. Ни unobserved `source.get()`, ни чужая native publication сами этот cache не обновляют.
- [`Models/Derived.ts:5–7`](../../lib/src/Carburetor/Models/Derived.ts#L5) обещает `IComputed.get(): R`, без `read()` capability; cached envelope нужен для `useSyncExternalStore`, а **returned R stays live**, не detached copy.
- [`Computed.ts:103–108,200–209,435–447`](../../lib/src/Carburetor/Derived/Computed.ts#L435): repaired native last-release path очищает `announced` и active filing; independent evaluation cache законно держит **current** value. No-hook native control в probe получает новый value и освобождает old target. Поэтому finding не приписывается этому repaired owner.
- [`getComputedSnapshotVersion.ts:5–11`](../../lib/src/Carburetor/Derived/Freshness/getComputedSnapshotVersion.ts#L5): native snapshot revision и public external version различаются; изменение cache ownership не может удалять этот publication token.

```text
module snapshots --(alive source key)→ old envelope → obsolete value → result subtree
source.get() → current value (уже другой graph)
```

**Не повтор R41-02:** здесь observer `announced` уже отсутствует; retained owner — `Interop/useComputedValue.snapshots`. Native no-hook positive release control и внешняя реализация без native announcement дают одинаковую границу. R43-C03 о retired sources в active announcement также не повторяется: targets здесь — **obsolete result subtrees**, источники не мигрируют.

### Наблюдение и controls

Probe A02, полный source ниже:

| Source | Только `source.get()`; затем новое value | SSR `useComputedValue`; затем новое value через `source.get()` |
|---|---|---|
| External public shape | Old marker collectible | **Old marker жив** |
| Native `computed(read => …)` | Old marker collectible | **Old marker жив** |

- В обеих SSR lanes HTML сначала `<p>1</p>`; source уже возвращает `n=2` до GC. Внешняя реализация имеет callbacks **0** — нет hidden subscription, удерживающей результат.
- Empty control collectible, caller-held strong target жив.
- Новый реальный SSR hook read возвращает `<p>2</p>`; после следующей GC phase **все четыре old markers collectible**. Source owners остаются живы.
- Stderr пустой; SSR hydration/React18 warning claims из этого не делаются. Здесь computed route, не repaired store layout diagnostic.

Высокая уверенность в cache-owner механизме. Исполненный surface — React19 Node SSR; lifetime на mounted/unmounted client, React18 и других formats в этом раунде агентом не проверялся. [INFERENCE] Та же global owner запись возможна после client source swap/unmount, но это пока не отдельный исполненный receipt.

[INFERENCE] Один последний envelope на каждый alive ранее прочитанный source может удерживать одно obsolete result graph до нового hook read или смерти source. Для N таких sources метаданные O(N), retained graph — объединение последних stale results. Это **не unbounded publication history** и не доказанный source leak: WeakMap key сам по себе не делает source живым.

### Консервативное направление и риски

Lifetime snapshot-value cache должен соответствовать actual consumer snapshot ownership, не всему lifetime source. Рассмотреть локальный cache hook instance либо weak ownership **envelope** при сохранении стабильного snapshot, который React реально использует. Не использовать weak-value ownership без envelope identity analysis. Простая очистка только в unsubscribe недостаточна: SSR lane вовсе не подписывается.

Tradeoff обязателен: per-hook cache может заменить одну source-shared запись на N consumer envelopes; weak cache добавляет WeakRef/runtime semantics. Поэтому не обещать «меньше allocations» от lifetime fix. Требовать warm repeated checks без snapshot churn и multi-consumer publication controls; не добавлять постоянно слушающий maintenance subscriber ради обновления глобального cache.

Сохранить `get()` **до** version read, native snapshot revision для unobserved changes и delivery при in-place изменении live Map/Set/envelope. Возврат raw value прямо в `useSyncExternalStore` вместо versioned envelope решит другую задачу неправильно и сломает stable-reference publications. Удаление `useComputedValue` или автоматическая замена его на `useCarburetorValue` не является compatible cutover.

### Предлагаемый permanent acceptance

Новая bounded family `hooks44/computed-snapshot-lifetime`:

1. Native/external no-hook controls и stale result после SSR hook read collectible при alive source, который уже отдаёт новый result; strong current result/caller-held old result остаются live.
2. Реальные client source swap/unmount + достаточно subsequent commits для Fiber turnover; SSR без subscribers, loads или commit effects. Fresh per-request sources остаются корректным обычным SSR pattern.
3. Existing `ComputedPublication.test.tsx` semantics: same-reference Map/Set/Date/envelope publication видна, equal primitive native result не коммитит update, explicit external equal-value version publication видна, changed value без changed external version всё ещё rechecked, lazy `get` before version read сохраняется.
4. Несколько concurrently mounted consumers, late callback, source equality/swap, StrictMode replay и speculative attempts не вызывают fabricated snapshot changes. Warm `getSnapshot` record identity сохраняется.
5. Format/React matrix выполнять parent последовательно. Отдельно измерить полные uninstrumented multi-consumer checks/publications и constructions; не превращать GC targets в allocated-byte metric.

## API ergonomics, callers и отклонённые кандидаты

### Разные supported capabilities — не лишние названия

| Surface | Текущий контракт и caller evidence | Почему «унифицировать удалением» неверно |
|---|---|---|
| Class `useCarburetor(source)` | Render-local live readonly view, source выбирается в render; `Reads.tsx:58–66`, packed `consumer.tsx:128,142` | Нужен для changing source и array-rooted scoped stores; implicit connection field имеет declaration-time facade kind |
| Class `connect(source/resolver)` | Persistent live facade, pure declaration, reads принадлежат attempt; `Reads.tsx:127–130`, `consumer.tsx:113,117` | Не detached memo-child value; replacing API селектором меняет identity/lifetime/read model |
| Class `connectSelection(source, select)` | Detached callable projection + committed notification gate; `consumer.tsx:115–120`, `ToDo/TodoApp.tsx:74`, conditional fixture выше | Реальный поддержанный transfer в memo child; A01 требует внутренней ownership поправки, не consumer migration |
| `useCarburetorValue` | `IReadableCarburetor<T>` + required selector + optional readonly comparator → `TReadonly<R>`; `Models/Store.ts:79–87`, `ProgressBadge.tsx:22`, packed `consumer.tsx:152–153` | Отдельное detached snapshot/path-tracking capability; computed не имеет `read/getData` |
| `useComputedValue` / class `useComputed` | `IComputed<R>.get()` + whole publication version; **live `R`**, `Derived.ts:5–7`, `Reads.tsx:352–359`, `ProgressBadge.tsx:21`, packed `consumer.tsx:126,154–155` | Version envelope нужен even для stable object reference; detached selector hook не эквивалентен |
| `useResourceValue` / class `useResource` | Hook — required synchronous selector, closed input, detached result и committed load; class — целый local resource facade, coarse field semantics. `useResourceValue.ts:24–49`, `Reads.tsx:379–520`, packed `consumer.tsx:194,203,221–227` | R41 clean cutover уже выполнен. Возвращать implicit whole-resource live view снова несовместимо с memo-child/ownership |

Actual frozen published `Interop/*.d.mts` прочитаны: эти различия есть и в declarations, не только в implementation. Optional interop exports (`Interop/index.ts:6–9`) и `package.json:23–35` отдельны от root component exports (`Carburetor/index.ts:37–44`). `TSelector` уже re-export, не вторая независимая type convention (`Interop/Models.ts:3–8`). **Нового evidence-backed public simplification/cutover не предлагается.** Обе находки разрешимы внутренне без signature/declaration/caller migration и без compatibility shim. Полного списка внешних npm consumers локальный reference search не даёт; их использование не объявляется отсутствующим.

### Кандидаты, не объявленные новыми findings

1. **Все R43-C01/C02/C03/S01/S02/S03/R01/R02/A01/A02 исключены как новые.** Raw attribution release виден в current source и collectible control A01; isomorphic store commit effects видны в `useCarburetorValue.ts:21,359–366`. Исправленные React18 console fixtures не анализируются как performance выигрыш и не объявляются сломанными.
2. **R41-01/02/03/04 и все R42 findings не перепечатаны.** A02 различает repaired last-observer announcement и interop global snapshot. R42-A01 committed-attempt guard сохранён. Resource closed candidates (`createResourceReader.ts:255–286`) и terminal generation/ownership читаются как действующий контракт, не новая находка.
3. **Stable subscription refile уже имеет no-churn gates.** Hook `install` (`useCarburetorValue.ts:168–178`) и class alignment (`Subscriptions.tsx:302–315`) adopt filed reads identity. Собственный A01 warm control подтверждает zero `read`/registration churn в узкой scalar lane; zero allocations для всех adapters не заявляются.
4. **Два store commit-effect reconciliations и wake-time install не удалять «как дубли».** Equal-valued branch migration может не вызвать React commit; notification-time `install` нужен (`useCarburetorValue.ts:193–199`). Layout acquisition перед passive сохраняется; `InteropCommitBoundary.test.tsx:35–92` защищает реальные write proofs и synchronous selector-only path delivery в owner layout. Эти fixtures здесь прочитаны, не запущены.
5. **Inline selector/class per-call bookkeeping не переименованы в новый perf finding.** Stable hook cache selector identity и warm inline reuse — `useCarburetorValue.ts:239–283`; class selectors intentionally читают props/state каждый вызов. Видимые temporary Set/`Array.from`/trace/cache records — source work, но не доказанный новый material allocation или asymptotic bottleneck. Hoist selectors только при действительно стабильной caller configuration; не добавить dependencies-array overload ради подавления чтений.
6. **Resource lifecycle token ≠ selected-value equality.** `createResourceReader.ts:178–189,325–328` может отдельно re-arm loading demand; количество уведомлений само по себе не доказывает unnecessary React render. TTL resolve каждый render (`useResourceValue.ts:28–34`) нужен freshness contract. Здесь такого extra-render receipt нет.
7. **Persistent facade cachedTarget/cachedView** (`ConnectionFacadeHandler.ts:92–106`) может оставаться после branch-off. Это другой graph/cache lifetime, не target A01 и не новая подтверждённая утечка: re-read identity/copy tradeoff не исследован отдельным controlled probe. Не обещать освобождение всего store graph от очистки `snapshotAttempt`.
8. **Scope/provider/bind/effects/shallowEqual.** Прочитаны existing conventions: provider передаёт scope identity, `scope.set` не обещает React notification, stable token names нужны SSR hydrate, `@bind` нужен detached callback + inheritance. Lazy effect records и isolated teardown сохраняют свои контракты. Pure symbol counts, boilerplate или failure-array counts не основание удалять supported adapter/extension point.
9. **Cross-topic array patch candidate** принадлежит Selection исполнителю: peer сообщил R44-S01 для graph array с поддержанным altered prototype и lost delivery через `before.slice()`. Hook/class UI variant мной не исполнялся; это не третий finding данного отчёта и не его runtime evidence.

## Воспроизводимые bounded probes

Ниже **точный source исполненных probes**, без временных implementation mutations. Агент подавал source через stdin из `Bun.spawn`; probe files не создавались. Рабочая директория — repo root; оба commands выполнялись последовательно:

```text
node --expose-gc --input-type=module - D:/dev/ReactCarburetor/worktrees/bench-dist/acfd3e2b8e58/esm-prod
```

В stdin подавался соответственно A01 или A02 block. Parent может сохранить blocks в ignored `worktrees/r44-probes/react-a01.mjs` и `react-a02.mjs` и выполнить эквивалентно, также последовательно:

```text
node --expose-gc worktrees/r44-probes/react-a01.mjs D:/dev/ReactCarburetor/worktrees/bench-dist/acfd3e2b8e58/esm-prod
node --expose-gc worktrees/r44-probes/react-a02.mjs D:/dev/ReactCarburetor/worktrees/bench-dist/acfd3e2b8e58/esm-prod
```

Текущие assertions **требуют наблюдённого baseline retention**. Для future fix acceptance A01 заменить только expected before-retained vector `[0, 0, count]` на `[0, 0, 0]`; A02 — `[false, true, false, true]` на `[false, false, false, false]`. Controls/DOM/re-arm assertions оставляются. Snippets непосредственно поддерживают ESM directories; CJS/four-format расширение loader — задача parent, не исполненный здесь matrix claim.

### Probe A01: stopped class selections

```js
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
process.env.NODE_ENV = 'production';
assert.equal(typeof globalThis.gc, 'function');
const require = createRequire(resolve('package.json'));
const {JSDOM} = require('jsdom');
const dom = new JSDOM('<!doctype html><body></body>', {url: 'http://localhost/'});
for (const key of ['window', 'document', 'HTMLElement', 'Node']) globalThis[key] = dom.window[key];
const React = require('react');
const {createRoot} = require('react-dom/client');
const {flushSync} = require('react-dom');
const bundle = resolve(process.argv[2]);
const {Carburetor, AntiHookComponent} = await import(pathToFileURL(resolve(bundle, 'Carburetor/index.mjs')).href);
const h = React.createElement;
const count = 4;
const marker = id => ({id, rows: Array.from({length: 4}, (_, n) => ({n}))});
class Store extends Carburetor {
  active = new Set(); adds = 0; drops = 0; reads = 0;
  edit(fn) { this.update(fn); }
  read(fn) { this.reads++; return super.read(fn); }
  subscribe(fn, options) { const id = super.subscribe(fn, options); this.active.add(id); this.adds++; return id; }
  unsubscribe(id) { this.active.delete(id); this.drops++; super.unsubscribe(id); }
}
function make(kind) {
  const stores = Array.from({length: count}, (_, n) => new Store({n: n + 1, unread: 0}));
  const refs = [];
  let commits = 0;
  class Owner extends AntiHookComponent {
    selections = kind === 'selection' ? stores.map(store => this.connectSelection(store, data => data.n)) : [];
    views = kind === 'connect' ? stores.map(store => this.connect(store)) : [];
    componentDidMount() { super.componentDidMount(); commits++; }
    componentDidUpdate(prev) { super.componentDidUpdate(prev); commits++; }
    render() {
      const slot = this.props.slot;
      if (slot < 0) return h('p', null, 'off');
      const value = kind === 'selection' ? this.selections[slot]()
        : kind === 'connect' ? this.views[slot].n : this.useCarburetor(stores[slot]).n;
      return h('p', null, value);
    }
  }
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const render = (slot, payload, tick) => flushSync(() => root.render(h(Owner, {slot, marker: payload, tick})));
  function visit(slot) {
    const payload = marker(kind + ':' + slot); refs.push(new WeakRef(payload));
    render(slot, payload, slot); assert.equal(host.textContent, String(slot + 1));
  }
  for (let slot = 0; slot < count; slot++) visit(slot);
  for (let tick = 10; tick < 16; tick++) render(-1, null, tick);
  assert.equal(host.textContent, 'off'); assert.ok(stores.every(store => store.active.size === 0));
  const quiet = commits;
  for (const store of stores) flushSync(() => store.edit(data => { data.n = 77; }));
  assert.equal(commits, quiet); assert.equal(host.textContent, 'off');
  return {kind, stores, refs, root, host, render, getCommits: () => commits};
}
function empty() { return new WeakRef(marker('empty')); }
const noOwner = empty(); const held = marker('strong'); const strong = new WeakRef(held);
const lanes = ['raw', 'connect', 'selection'].map(make);
const turn = () => new Promise(resolve => setImmediate(resolve));
async function collect() { for (let i = 0; i < 16; i++) { await turn(); globalThis.gc(); } await turn(); }
try {
  await collect();
  function receipt() {
    assert.equal(noOwner.deref(), undefined); assert.equal(strong.deref(), held);
    return lanes.map(lane => ({kind: lane.kind, retained: lane.refs.filter(ref => ref.deref() !== undefined).length,
      active: lane.stores.reduce((n, store) => n + store.active.size, 0), dom: lane.host.textContent}));
  }
  const before = receipt(); assert.deepEqual(before.map(lane => lane.retained), [0, 0, count]);
  for (const lane of lanes) {
    for (let slot = 0; slot < count; slot++) { lane.render(slot, null, 20 + slot); assert.equal(lane.host.textContent, '77'); }
    const store = lane.stores[count - 1];
    const warm = [store.reads, store.adds, store.drops];
    lane.render(count - 1, null, 30); lane.render(count - 1, null, 31);
    assert.deepEqual([store.reads, store.adds, store.drops], warm, 'warm root and registration reuse');
    const quiet = lane.getCommits();
    flushSync(() => store.edit(data => { data.unread++; })); assert.equal(lane.getCommits(), quiet);
    flushSync(() => store.edit(data => { data.n = 78; })); assert.equal(lane.host.textContent, '78');
    assert.ok(lane.getCommits() > quiet); assert.equal(store.active.size, 1);
    for (let tick = 40; tick < 46; tick++) lane.render(-1, null, tick);
  }
  await collect(); const after = receipt(); assert.ok(after.every(lane => lane.retained === 0));
  console.log(JSON.stringify({node: process.version, react: React.version, bundle, count, before, after,
    emptyCollected: true, strongAlive: true, hiddenWritesSilent: true, rearmDom: '78', warmRegistrationReuse: true}));
} finally {
  for (const lane of lanes) { flushSync(() => lane.root.unmount()); assert.ok(lane.stores.every(store => store.active.size === 0)); lane.host.remove(); }
  dom.window.close();
}
```

### Probe A02: stale computed-hook snapshot value

```js
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
process.env.NODE_ENV = 'production';
assert.equal(typeof globalThis.gc, 'function');
const require = createRequire(resolve('package.json'));
const React = require('react');
const {renderToString} = require('react-dom/server');
const bundle = resolve(process.argv[2]);
const {Carburetor, computed} = await import(pathToFileURL(resolve(bundle, 'Carburetor/index.mjs')).href);
const {useComputedValue} = await import(pathToFileURL(resolve(bundle, 'Interop/index.mjs')).href);
const h = React.createElement;
const marker = id => ({id, rows: Array.from({length: 4}, (_, n) => ({n}))});
class Store extends Carburetor { edit(fn) { this.update(fn); } }
class External {
  value; version = 0; callbacks = new Map(); next = 0;
  constructor(value) { this.value = value; }
  getUID() { return 'external'; }
  getVersion() { return this.version; }
  get() { return this.value; }
  subscribe(fn) { const id = String(++this.next); this.callbacks.set(id, fn); return id; }
  unsubscribe(id) { this.callbacks.delete(id); }
}
function View({source}) { return h('p', null, useComputedValue(source).n); }
function make(kind, viaHook) {
  let source, store;
  if (kind === 'external') source = new External({n: 1, marker: marker(kind)});
  else {
    store = new Store({n: 1});
    source = computed(read => { const n = read(store).n; return {n, marker: marker(n)}; });
  }
  const first = source.get();
  const ref = new WeakRef(first.marker);
  const html = viaHook ? renderToString(h(View, {source})) : '<p>' + first.n + '</p>';
  assert.equal(html, '<p>1</p>');
  if (kind === 'external') { source.value = {n: 2, marker: marker('new')}; source.version++; }
  else store.edit(data => { data.n = 2; });
  assert.equal(source.get().n, 2);
  if (kind === 'external') assert.equal(source.callbacks.size, 0, 'server installs no subscription');
  return {kind, viaHook, source, store, ref, html};
}
function empty() { return new WeakRef(marker('empty')); }
const noOwner = empty();
const held = marker('strong'); const strong = new WeakRef(held);
const lanes = ['external', 'native'].flatMap(kind => [false, true].map(viaHook => make(kind, viaHook)));
const turn = () => new Promise(resolve => setImmediate(resolve));
async function collect() { for (let i = 0; i < 16; i++) { await turn(); globalThis.gc(); } await turn(); }
await collect();
function firstReceipt() {
  assert.equal(noOwner.deref(), undefined); assert.equal(strong.deref(), held);
  return lanes.map(lane => ({kind: lane.kind, viaHook: lane.viaHook, oldMarkerRetained: lane.ref.deref() !== undefined}));
}
const before = firstReceipt();
assert.deepEqual(before.map(lane => lane.oldMarkerRetained), [false, true, false, true]);
for (const lane of lanes) if (lane.viaHook) assert.equal(renderToString(h(View, {source: lane.source})), '<p>2</p>');
await collect();
const after = lanes.map(lane => ({kind: lane.kind, viaHook: lane.viaHook, oldMarkerRetained: lane.ref.deref() !== undefined}));
assert.ok(after.every(lane => !lane.oldMarkerRetained));
console.log(JSON.stringify({node: process.version, react: React.version, bundle, before, after, emptyCollected: true, strongAlive: true, serverHtml: ['<p>1</p>', '<p>2</p>']}));
```

## Фактически полученный stdout/stderr

Оба processes завершились **exit 0**, stderr — **пустой**. Порядок в журнале был A02, затем A01; таблица/report ranking не является порядком запуска.

### A01

```json
{"node":"v24.12.0","react":"19.3.0","bundle":"D:\\dev\\ReactCarburetor\\worktrees\\bench-dist\\acfd3e2b8e58\\esm-prod","count":4,"before":[{"kind":"raw","retained":0,"active":0,"dom":"off"},{"kind":"connect","retained":0,"active":0,"dom":"off"},{"kind":"selection","retained":4,"active":0,"dom":"off"}],"after":[{"kind":"raw","retained":0,"active":0,"dom":"off"},{"kind":"connect","retained":0,"active":0,"dom":"off"},{"kind":"selection","retained":0,"active":0,"dom":"off"}],"emptyCollected":true,"strongAlive":true,"hiddenWritesSilent":true,"rearmDom":"78","warmRegistrationReuse":true}
```

### A02

```json
{"node":"v24.12.0","react":"19.3.0","bundle":"D:\\dev\\ReactCarburetor\\worktrees\\bench-dist\\acfd3e2b8e58\\esm-prod","before":[{"kind":"external","viaHook":false,"oldMarkerRetained":false},{"kind":"external","viaHook":true,"oldMarkerRetained":true},{"kind":"native","viaHook":false,"oldMarkerRetained":false},{"kind":"native","viaHook":true,"oldMarkerRetained":true}],"after":[{"kind":"external","viaHook":false,"oldMarkerRetained":false},{"kind":"external","viaHook":true,"oldMarkerRetained":false},{"kind":"native","viaHook":false,"oldMarkerRetained":false},{"kind":"native","viaHook":true,"oldMarkerRetained":false}],"emptyCollected":true,"strongAlive":true,"serverHtml":["<p>1</p>","<p>2</p>"]}
```

## Пределы проверки и hand-off

- Confirmed receipts относятся только к **ESM-production × React19.3.0 × Node24.12.0**, bounded targets/операциям в приведённом source. GC — collectibility при alive owners и job boundaries; ни размер heap saving, ни гарантированный GC deadline не доказаны.
- A01 — настоящий mounted class consumer с controls, не direct private-method simulation. A02 — настоящий SSR hook consumer и real native/external APIs; client turnover claim отдельно отмечен [INFERENCE]. Ни один finding не основан на предположении «больше низкоуровневых notifications значит больше React renders».
- Suspense/abandoned attempt, StrictMode, hydration, React18 и other formats здесь **не исполнялись**. Предлагаемые fixes пока не существуют; измеренного A/B improvement нет. Existing fixture assertions прочитаны как constraints, их PASS не заявляется.
- Parent должен независимо повторить эти два serial probes, затем проверить future fix lifetime/identity и перечисленные ownership/layout/path-wake/publication controls. Не заменять полноценный acceptance более узким сохранением `active=0` или правильного HTML.
- Отчёт содержит законченные новые findings, consumer/reference analysis, ruled-out candidates и executable bounded sources. Production/tests/docs API намеренно unchanged: это review-only, не implementation hand-off с незавершённым кодом.

# Раунд 42 — React API, подписки и update waves

Дата: **2026-10-10**. Reviewed base: **`fa1ad08f8cd6b26f175235a435976fcb9d94dd22`**.
Ветка: `review-r42-react-api-20261010`.

Это review-only отчет: production, tests, benchmarks, конфигурация и версии не изменялись. Единственный tracked change — этот документ.

## Результат

| ID | Приоритет | Симптом / стоимость | Текущий источник | Evidence |
|---|---|---|---|---|
| **R42-A01** | **P1, correctness** | После suspended transition `connectSelection` сравнивает notification с незакоммиченным результатом и props, переносит подписку с видимой ветки `a` на невидимую `b`; DOM перестает получать изменения `a` | `lib/src/Carburetor/Component/AntiHookComponent/Reads.tsx:180-240,251-335`; `Foundation.tsx:273-300,332-334`; `Subscriptions.tsx:230-253` | **Исполнено:** React 19.3.0 + ReactDOM/JSDOM, self/child suspension, StrictMode, три сочетания module formats; raw class и hook — положительные контроли |

Новых доказанных performance findings нет. Счетчики стабильных parent renders не обнаружили subscription churn; перепроведение известных inline-selector и notification/render затрат как новых находок не оправдано. Этот отчет не является реализацией оптимизации и не заявляет measured speedup.

## База, границы и метод

- Все исходники, git-команды и пробы использовали `D:/dev/ReactCarburetor/worktrees/review-r42-react-api-20261010`.
- Текущий `dist` в этом worktree — read-only junction на поставленную orchestrator distribution `D:/dev/ReactCarburetor/worktrees/bench-dist/fa1ad08f8cd6`, собранную именно из reviewed base. Использовался только `worktree/dist`; повторная сборка не выполнялась. Общие `node_modules` не изменялись.
- Наблюдаемые версии: Node **v24.12.0**, `react` **19.3.0**, `react-dom` **19.3.0**, `jsdom` **30.0.1**. Реальный ReactDOM `createRoot`, а не mock renderer; окружение DOM — JSDOM, не браузер.
- Поставленная база имеет authoritative GREEN [GitHub CI 38075943238](https://github.com/PHPCraftdream/ReactCarburetor/actions/runs/38075943238), 11/11 jobs. Это сведения baseline от orchestrator, **не запущенная здесь проверка отчета**.
- Прочитаны оба external-store hooks, class `Foundation/Reads/Subscriptions/Effects`, `declareConnection`, connection models, Scope/provider/token и публичные subscription/selector types; вся реализация `UpdateWave`, sync scheduler, throttle и transaction boundary. Resource reader использовался лишь для понимания границы class API; resource internals и общий selection algorithm не относятся к этой теме.
- Прочитаны соответствующие части `Interop.test.tsx`, `ComputedPublication.test.tsx`, class connection/lifecycle/effects/type/Scope tests, `ComponentUpdateThrottleDelivery.test.tsx`, `StoreDeliveryIdentity.test.ts`, существующие `components`, `hooks`, `delivery` scenarios/gates. Это source review существующих контрактов, **не выполнение этих tests/gates**.
- LSP не доступен: `read xd://lsp` вернул `No such tool`, mounted devices только `ast_edit, debug`. Использованы scoped `read`/`grep`.
- Новизна сверена с R40 report и R41 resolution/CI follow-up, а также с R36/R37/R38 invariants и R39 rejected candidates. R40 symbol-private cutover, R41 resource memo snapshot и Node SSR commit-effect fix не переименовываются в R42 findings.

## R42-A01 — notification gate использует speculative class selection

### Проблема и наблюдаемое нарушение

Публичный, рекомендованный pattern без lifecycle overrides:

```js
class Owner extends AntiHookComponent {
  pick = this.connectSelection(() => store, d => d[this.props.branch]);
  render() {
    const value = this.pick();
    if (this.props.block) throw pendingPromise;
    return React.createElement('p', null, this.props.branch + ':' + value);
  }
}
```

1. Store `{a: 1, b: 2}`; committed props `{branch: 'a', block: false}`; видимый DOM `a:1`, подписка `['a']`.
2. `React.startTransition` предлагает `{branch: 'b', block: true}`. Render читает `2` и suspends. Старый DOM **остается** `a:1`; подписка пока корректно остается `['a']`.
3. При `store.update(d => { d.a = 2; })` существующая подписка вызывает selection gate. Gate считает speculative `b === 2` равным последнему, тоже speculative, snapshot `2` и **не forceUpdate-ит owner**. Scratch reads переносятся в committed subscription: теперь `['b']`.
4. DOM остается `a:1`, хотя текущий store уже содержит `a:2`. Обычный `root.render` с прежними props `{a,false}` не спасает: props gate пропускает работу. Следующее `a = 3` тоже не доставляется, DOM все еще `a:1`.
5. Unmount освобождает подписку: это **ошибка владения/доставки**, не заявленная retention leak.

Тот же сбой воспроизведен, когда `Owner.render()` **успешно возвращает** дерево, а suspends дочерний `<Gate/>`. В таком случае собственный render boundary owner не может отметить `attempt.abandoned` по исключению дочернего Fiber. Поэтому проверка только `abandoned` не покрывает проблему.

Raw class `useCarburetor` и `useCarburetorValue` на тех же операциях дают `a:2`, затем `a:3`, сохраняя reads `['a']`. StrictMode не устраняет дефект selected class. Никаких прямых вызовов `owner.render()`, ручных commit callbacks, мутаций props, source patches или искусственных private-state подмен в пробе нет.

### Механизм в текущем source

- `Reads.tsx:180-185` держит `snapshot/live/ledger` в closure одной connection. Возвращенная selection-функция обновляет их **в render**, до commit (`:251-335`), включая snapshot примитивного результата.
- Notification fast path проверяет только открытый `this[C.renderAttempt]` (`:193-197`). После выхода render `Foundation.tsx:332-334` оставляет `pendingAttempt`, но очищает `renderAttempt`. Незакоммиченный render уже не считается «in flight» этим guard.
- `select(view)` при notification (`Reads.tsx:205-210`) использует обычное `this.props`. В исполненной пробе instance после suspension имеет props `{branch:'b',block:true}`, при этом DOM принадлежит committed `{branch:'a',block:false}`. Комментарий о committed props на `:187-190` не обеспечивает этот контракт.
- Same-source ветка проходит проверку `declared.getCarburetor() !== committed.carburetor` (`:236-238`), поскольку обе props-ветки читают один store. `migrateConnectionReads` затем переписывает подписку/committed reads и baseline (`Subscriptions.tsx:230-253`).
- `commitSubscriptions` уже различает fresh/committed attempts по identity (`Subscriptions.tsx:59-69`). Но notification gate не использует ту же commit-ownership границу.

**Новизна:** это не generic equality/structural sharing, не raw/live child-props caveat, не R40/R41 resource memo issue. Примитивные `1/2` достаточны. R36-02 и R37-06 обещают notification selection по committed props; существующий тест `connect/selection-gate.test.tsx:98-121` меняет props с завершенным commit. Guard test `:287-327` проверяет notification **внутри** render. `lifecycle/render-attempts.test.tsx` покрывает raw `connect`; `trackrelease-followup39/abandoned.test.tsx:62-83` проверяет восстановление proof ownership через ручной replay, а не notification gate после real suspended transition. Новая проба закрывает именно промежуток **render закрылся, commit не произошел, старый UI еще виден**.

### Предлагаемое безопасное действие, не реализовано

Сначала ограничить существующий notification fast path **commit ownership**, а не только наличием открытого render. Если последний selection/render attempt не подтвержден commit владельца, callback должен идти по уже существующему безопасному `forceUpdate` пути **до исполнения speculative selector и до read migration**. Дочернее suspension, не только throw из собственного render, обязательно должно попадать в эту ветку.

[INFERENCE] Минимальный кандидат — сверка identity pending/committed attempts с нужной connection provenance перед fast path; это может быть O(1) guard без нового публичного API, cache, deep copy props или временной подмены `this.props`. Проверять его надо на real React lifecycle, не считать предложенный guard уже доказанным исправлением. Если для конкретной формы connection этих identities недостаточно, selection comparison baseline должен быть опубликован только ее commit, а tentative результат не должен заменять этот baseline.

Не предлагается отключать equality gate вообще: его обычный equal-valued branch migration — доказанная полезная семантика R37-06. Не предлагается consumer workaround «сменить key/remount» или специальная обработка `a/b`; необходимо восстановить общую границу render/commit.

### API / complexity / allocation / render tradeoffs

- Сохранить `connectSelection(source, select)` и существующий field-initializer + render-call pattern. Нового публичного параметра не требуется.
- Correctness важнее speculative bailout: notification при незакоммиченном состоянии может потребовать owner render, даже если speculative ответ выглядит равным.
- [INFERENCE] Identity guard — постоянная работа; normal committed lane должна сохранить zero renders для равного результата и миграцию закрытых reads без render. Не измерены bytes, overhead guard или общая latency до/после. Дополнительный committed slot, если понадобится, — tradeoff metadata/lifetime, а не бесплатная оптимизация.
- Не сломать существующие detached snapshot identities и memo-child bailout при unrelated parent renders. Общее ускорение selection/reconcile вне этого исправления не является целью.

### Инварианты и adversarial cases для реализации

1. Видимый committed `a:1` остается подписан на `a` до actual commit `b`; suspension не имеет права опубликовать `b` reads или baseline.
2. `a=2` во время suspended transition должен обновить видимый DOM на `a:2`, а последующее `a=3` — на `a:3`; равенство с speculative `b` не аргумент для bailout.
3. Проверить self suspension и child suspension, завершение pending transition и отмену возвратом прежних props, branch values equal и unequal, selector по props и по state, source resolver swap между stores.
4. После настоящего commit `b` подписка должна следовать `b`, а `a` стать unread. Equal store-driven branch switch **без** незакоммиченного render по-прежнему не должен рендерить owner.
5. StrictMode mount replay, Suspense hide/reveal, notification внутри render, selector throw, render→commit write gap, unmount/captured late callback не должны терять зависимости или восстанавливать освобожденную subscription.
6. Получение subscription/read ownership не должно стать render side effect. Поддержанные lifecycle method overrides с `super` и modern lifecycles сохранить.

Пункты сверх непосредственно исполненного scenario — **план проверки**, не уже проверенные свойства исправления.

### Новый benchmark и старые gates

Предложить `components/selection-commit-ownership` как **новый deterministic behavioral benchmark**:

- Actual `createRoot`/DOM, branch-by-props class selection, retained visible Suspense tree; self/child suspension, cancel/resume; raw class/hook controls.
- Gates: видимый DOM после первого/второго `a` write `a:2/a:3`; reads не мигрируют на `b` без commit; active subscriptions 1 до unmount и 0 после; после actual `b` commit доставляется его edit. Не pin-ить полный render count speculative attempts между React 18/19.
- Отдельный normal lane: equal-valued store branch switch дает owner/child render deltas 0/0, old branch silent, actual selected edit меняет DOM.
- Если понадобится оценить цену safe fallback, измерять **всю операцию** transition + notification + DOM commit и normal committed lane при 1/50/500 owners; отдельно селектор/подписки/commits, warm-up и повторные процессы. Это будущий, не выполненный sweep; нет обещания speedup.

Старые gates сохранить: `components/branch-migration@1`, `components/proxy-reads`, `components/mount-edit@1k/@4k`, `hooks/r33-snapshot@10k`, `hooks/memo-rows@1k/@10k`, `hooks/drift-after-related@10k-stable/@10k-inline`, `delivery/throttle-cancel`, `delivery/store-delivery`. Существующие class lifecycle/StrictMode/selection-gate/teardown tests, `ComputedPublication` и cross-format consumer matrix защищают другие границы. Они здесь не запускались.

## Контроли и отклоненные кандидаты

### Исполненные bounded controls

`worktrees/r42-react-api-controls.cjs` выполнил шесть unrelated parent renders для stable hook, fresh-inline hook и class `connectSelection`, equal-valued store branch migration, real edit и source swap. Дельты warmed parent window:

| API | Owner renders | Memo-child renders | Selector calls | subscribe / unsubscribe | `store.read()` |
|---|---:|---:|---:|---:|---:|
| stable hook | 6 | 0 | 0 | 0 / 0 | 0 |
| inline hook | 6 | 0 | 6 | 0 / 0 | 0 |
| class selection | 6 | 0 | 6 | 0 / 0 | 0 |

- Unread edit и edit старой ветки после **обычного committed** equal branch migration: owner/child deltas 0/0 во всех трех lanes.
- Equal migration: owner/child 0/0; hook делает subscribe/unsubscribe 1/1, class — same-ID replacement 1/0. Это смена read ownership, не leak и не unwanted churn.
- Реальное `right=3`: owner/child 1/1, DOM `3`; selector calls stable/inline/class — 1/2/2. Последние два повторных вызова — уже записанный в R39 tradeoff notification-time comparison + render.
- Resolver/source swap: DOM `10`, old/new active 0/1; old-source edit оставляет `10`, new-source edit дает `11`; unmount — 0/0.
- Sync two-store transaction с composed computed: DOM `2→5`, один subscriber delivery `[5]`, renders `1→2`; промежуточной доставки `3/4` не наблюдалось.
- Controlled throttle: до manual flush DOM `2`, renders 1, deliveries `[]`; после flush DOM `5`, renders 2, deliveries `[5]`. Это проверяет **queue/drain**, не реальные timer latency или frame coalescing.
- Cancel/replace в active throttle round: `['first','other','new']`, obsolete callback не вызван. После обоих composed-computed lanes underlying stores имеют active counts 0/0.

### Не новые findings

- **Inline selectors и повторная class selection.** Наблюдаемые вызовы выше согласуются с текущими контрактами и `R39:486-490`; не являются доказанным новым whole-operation bottleneck. Hoisted selector уже поддержан. Новый cache/API без доказанного выигрыша не предлагается.
- **Повторные hook commit `install()` и `sameReads`.** В source есть две layout effects и reconciliation на wake. Stable lane не re-files subscription; sameReads content-equal adoption сохраняет filed identity. [INFERENCE] Здесь остается небольшое commit bookkeeping, но его материальная цена не измерена. Удалять wake reconciliation опасно: equal answer может переместить reads без React render.
- **`useComputedValue` возвращает live value.** Versioned snapshot envelope на `useComputedValue.ts:15-50` намеренно не клонирует результат. Same-reference Map/Set/Date publication имеет отдельные tests в `ComputedPublication`; отдача такого live result в shallow memo-child не обещает detached semantics. Не переименовывать документированный выбор в correctness defect. В runtime wave control упражнен primitive computed; native publication cases здесь только прочитаны.
- **UpdateWave batch snapshot.** `UpdateWave.ts:58-68` материализует entries перед drain, очищает pending и сохраняет отложенную следующую волну; `ComponentUpdateThrottle.ts:135-146` уже переиспользует Map rounds и поддерживает cancellation/replacement. [INFERENCE] Простая замена wave snapshot на обход живой Map меняет reentrant semantics. Число tuple/Array constructions не равно total allocated bytes; whole-operation A/B не выполнен, нового perf finding нет.
- **Connection API constraints.** `connect`/`connectSelection` объявляются один раз; resolver нужен для props source swap. Live `connect` не предназначен для detached memo child, opaque-root fallback и fixed facade kind уже описаны в README/Reads. Changing root kind/array subclasses не маскируются новой abstraction.
- **Lifecycle overrides.** Method `render` и constructor assignment поддержаны; class-field `render` отвергается own non-configurable accessor (`Foundation.tsx:125-184`). Methods lifecycle требуют `super`; `docs/rules.md:70,83` уже содержит соответствующие native lint rules. Предпочтительный effect extension point — `useEffects`, а не новое hook-like lifecycle API. Неправильный consumer override без `super` не объявлен новым engine bug.
- **Effects/teardown.** Source сохраняет cleanup-before-replacement и isolated unmount stages; существующие tests защищают бросающие cleanup/setup. Failure-array/closure микрозатраты не измерены как material; отчёт не предлагает менять exception policy ради устранения allocation.
- **Scope.** Stable token names, per-request scope, own-key-safe dehydrate/hydrate и shared cross-format context уже существующий контракт. Mutable `scope.set` не добавляет публичную React notification; это средство установки/preparation, не новый reactive provider API.
- **Решенные границы.** R40 private symbols/read completion/native iteration; R41 selector-required detached resource hook, stable-selector memo-child behavior и SSR effect choice не являются новыми находками. Positional/structural whole reconcile, immutable flat-array spine, object-keyed native conservative equality, cyclic working set и coarse native topology — ранее записанные ограничения R37/R39, не эта тема.

## Воспроизводимость: точные команды и исполняемые snippets

Все следующие shell-команды исполнялись с cwd:

```text
D:/dev/ReactCarburetor/worktrees/review-r42-react-api-20261010
```

### Идентичность

```sh
git status --short --branch && git rev-parse HEAD && node -p "JSON.stringify({node:process.version,react:require('react/package.json').version,reactDom:require('react-dom/package.json').version,jsdom:require('jsdom/package.json').version})"
```

Observed:

```text
## review-r42-react-api-20261010
fa1ad08f8cd6b26f175235a435976fcb9d94dd22
{"node":"v24.12.0","react":"19.3.0","reactDom":"19.3.0","jsdom":"30.0.1"}
```

### R42-A01: полный финальный probe

Сохранить следующий CommonJS snippet как `worktrees/r42-react-api-concurrent.cjs` внутри assigned worktree (путь git-ignored). Такой файл уже оставлен там для orchestrator. Он не входит в commit и не меняет distribution.

```js
'use strict';
const {JSDOM} = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost/'});
for (const key of ['window', 'document', 'HTMLElement', 'Node']) global[key] = dom.window[key];
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const {createRoot} = require('react-dom/client');
let AntiHookComponent, Carburetor, useCarburetorValue;
const engineFormat = process.argv[2] ?? 'cjs';
const storeFormat = process.argv[3] ?? engineFormat;
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const load = (format, part) => {
  const entry = path.resolve(__dirname, '..', 'dist', format, part, 'index.' + (format.startsWith('esm') ? 'mjs' : 'js'));
  return format.startsWith('esm') ? import(pathToFileURL(entry).href) : Promise.resolve(require(entry));
};
const h = React.createElement;
async function lane(kind, strict, suspension = 'self') {
  class Store extends Carburetor {
    edit(fn) { this.update(fn); }
    subscribe(callback, options) {
      const id = super.subscribe(callback, options);
      this.active ??= new Map(); this.active.set(id, [...(options?.reads ?? [])]); return id;
    }
    unsubscribe(id) { this.active?.delete(id); super.unsubscribe(id); }
  }
  const store = new Store({a: 1, b: 2});
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const gate = new Promise(() => {});
  const renders = []; let owner;
  const state = () => ({dom: container.textContent, reads: [...(store.active?.values() ?? [])]});
  function Gate() { throw gate; }
  const output = (props, value) => {
    if (props.block && suspension === 'self') throw gate;
    return h(React.Fragment, null,
      h('p', null, props.branch + ':' + value), props.block ? h(Gate) : null);
  };
  class Selected extends AntiHookComponent {
    pick = this.connectSelection(() => store, d => d[this.props.branch]);
    render() {
      const value = this.pick();
      renders.push([this.props.branch, this.props.block, value]);
      return output(this.props, value);
    }
  }
  class Raw extends AntiHookComponent {
    render() {
      const value = this.useCarburetor(store)[this.props.branch];
      renders.push([this.props.branch, this.props.block, value]);
      return output(this.props, value);
    }
  }
  function Hook(props) {
    const value = useCarburetorValue(store, d => d[props.branch]);
    renders.push([props.branch, props.block, value]);
    return output(props, value);
  }
  const Component = kind === 'selected' ? Selected : kind === 'raw' ? Raw : Hook;
  const tree = (branch, block) => {
    const child = h(Component, {branch, block, ...(kind === 'hook' ? {} : {ref: instance => { if (instance) owner = instance; }})});
    const boundary = h(React.Suspense, {fallback: h('p', null, 'fallback')}, child);
    return strict ? h(React.StrictMode, null, boundary) : boundary;
  };
  await React.act(async () => { root.render(tree('a', false)); });
  const mounted = state();
  await React.act(async () => { React.startTransition(() => root.render(tree('b', true))); });
  const suspended = {...state(), ownerProps: owner?.props};
  await React.act(async () => { store.edit(d => { d.a = 2; }); });
  const changed = state();
  await React.act(async () => { root.render(tree('a', false)); });
  const recovered = state();
  await React.act(async () => { store.edit(d => { d.a = 3; }); });
  const later = state();
  await React.act(async () => root.unmount());
  container.remove();
  return {kind, strict, suspension, mounted, suspended, changed, recovered, later, released: store.active?.size, renders};
}
(async () => {
  ({AntiHookComponent} = await load(engineFormat, 'Carburetor'));
  ({Carburetor} = await load(storeFormat, 'Carburetor'));
  ({useCarburetorValue} = await load(engineFormat, 'Interop'));
  console.log(JSON.stringify({node: process.version, react: React.version, engineFormat, storeFormat}));
  for (const args of [
    ['selected', false], ['raw', false], ['hook', false], ['selected', true], ['hook', true],
    ['selected', false, 'child'], ['raw', false, 'child'], ['hook', false, 'child']
  ]) console.log(JSON.stringify(await lane(...args)));
  dom.window.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
```

Точные выполненные команды финальной формы:

```sh
node worktrees/r42-react-api-concurrent.cjs cjs cjs && node worktrees/r42-react-api-concurrent.cjs esm cjs && node worktrees/r42-react-api-concurrent.cjs cjs-prod esm-prod
```

Каждое сочетание выполнило 8 lanes. `cjs-prod/esm-prod` — **production library bundles с development React для `act`**, не production React performance run. Mixed development formats напечатали обычные duplicate-copy diagnostics; они не подавлялись и не считаются новой ошибкой. Mixed production-library lane такого вывода не имел.

Полные representative JSON-строки из current `cjs/cjs` stdout:

```json
{"kind":"selected","strict":false,"suspension":"self","mounted":{"dom":"a:1","reads":[["a"]]},"suspended":{"dom":"a:1","reads":[["a"]],"ownerProps":{"branch":"b","block":true}},"changed":{"dom":"a:1","reads":[["b"]]},"recovered":{"dom":"a:1","reads":[["b"]]},"later":{"dom":"a:1","reads":[["b"]]},"released":0,"renders":[["a",false,1],["b",true,2]]}
{"kind":"raw","strict":false,"suspension":"self","mounted":{"dom":"a:1","reads":[["a"]]},"suspended":{"dom":"a:1","reads":[["a"]],"ownerProps":{"branch":"b","block":true}},"changed":{"dom":"a:2","reads":[["a"]]},"recovered":{"dom":"a:2","reads":[["a"]]},"later":{"dom":"a:3","reads":[["a"]]},"released":0,"renders":[["a",false,1],["b",true,2],["a",false,2],["b",true,2],["a",false,3]]}
{"kind":"hook","strict":false,"suspension":"self","mounted":{"dom":"a:1","reads":[["a"]]},"suspended":{"dom":"a:1","reads":[["a"]]},"changed":{"dom":"a:2","reads":[["a"]]},"recovered":{"dom":"a:2","reads":[["a"]]},"later":{"dom":"a:3","reads":[["a"]]},"released":0,"renders":[["a",false,1],["b",true,2],["a",false,2],["b",true,2],["a",false,2],["a",false,3]]}
```

Остальные наблюденные варианты имеют те же DOM/reads/release outcomes:

| Вариант | После `a=2` | После cancel + `a=3` | Subscription после notification |
|---|---|---|---|
| selected, StrictMode, self | `a:1` | `a:1` | `b` |
| hook, StrictMode, self | `a:2` | `a:3` | `a` |
| selected, child | `a:1` | `a:1` | `b` |
| raw/hook, child | `a:2` | `a:3` | `a` |
| selected в `esm/cjs` и `cjs-prod/esm-prod`, self/child | `a:1` | `a:1` | `b` |
| raw/hook в этих mixed lanes | `a:2` | `a:3` | `a` |

Во всех 24 финальных lanes `released:0`. Кроме финальных команд выше, первоначальная версия этого probe без read-set logging/child case была исполнена как `node worktrees/r42-react-api-concurrent.cjs` и дала такой же stale DOM для selected class; доказательство отчета опирается на финальный snippet.

### Полный bounded controls probe

Сохранить как `worktrees/r42-react-api-controls.cjs` (также уже оставлен в ignored directory):

```js
'use strict';
const {JSDOM} = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost/'});
for (const key of ['window', 'document', 'HTMLElement', 'Node']) global[key] = dom.window[key];
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const {createRoot} = require('react-dom/client');
const {AntiHookComponent, Carburetor, ComponentUpdateThrottle, computed, transaction} = require('../dist/cjs/Carburetor/index.js');
const {useCarburetorValue, useComputedValue} = require('../dist/cjs/Interop/index.js');
const h = React.createElement;
class Store extends Carburetor {
  adds = 0; drops = 0; readCalls = 0; active = new Set();
  edit(fn) { this.update(fn); }
  read(record) { this.readCalls++; return super.read(record); }
  subscribe(fn, options) { this.adds++; const id = super.subscribe(fn, options); this.active.add(id); return id; }
  unsubscribe(id) { this.drops++; this.active.delete(id); super.unsubscribe(id); }
}
async function renderLane(kind) {
  const store = new Store({useLeft: true, left: 1, right: 1, unrelated: 0});
  const second = new Store({useLeft: false, left: 10, right: 10, unrelated: 0});
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  let renders = 0, children = 0, selections = 0;
  const select = d => { selections++; return {n: d.useLeft ? d.left : d.right}; };
  const Child = React.memo(({value}) => { children++; return h('p', null, value.n); });
  function Hook(props) {
    renders++;
    const value = useCarburetorValue(props.store, kind === 'stable-hook' ? select : d => select(d));
    return h(Child, {value});
  }
  class Owner extends AntiHookComponent {
    pick = this.connectSelection(() => this.props.store, select);
    render() { renders++; return h(Child, {value: this.pick()}); }
  }
  const Component = kind === 'class-selection' ? Owner : Hook;
  const tree = (source, tick) => h(Component, {store: source, tick});
  const counters = () => ({renders, children, selections, adds: store.adds, drops: store.drops, readCalls: store.readCalls});
  const delta = before => Object.fromEntries(Object.entries(counters()).map(([key, value]) => [key, value - before[key]]));
  await React.act(async () => root.render(tree(store, 0)));
  const beforeParents = counters();
  for (let tick = 1; tick <= 6; tick++) await React.act(async () => root.render(tree(store, tick)));
  const parents = delta(beforeParents);
  let before = counters();
  await React.act(async () => store.edit(d => { d.unrelated++; }));
  const unread = delta(before);
  before = counters();
  await React.act(async () => store.edit(d => { d.useLeft = false; }));
  const equalSwitch = delta(before);
  before = counters();
  await React.act(async () => store.edit(d => { d.left = 2; }));
  const oldBranch = delta(before);
  before = counters();
  await React.act(async () => store.edit(d => { d.right = 3; }));
  const realChange = {...delta(before), dom: container.textContent};
  await React.act(async () => root.render(tree(second, 7)));
  const swap = {dom: container.textContent, oldActive: store.active.size, newActive: second.active.size};
  await React.act(async () => store.edit(d => { d.right = 4; }));
  const oldSourceDom = container.textContent;
  await React.act(async () => second.edit(d => { d.right = 11; }));
  const newSourceDom = container.textContent;
  await React.act(async () => root.unmount()); container.remove();
  return {kind, parents, unread, equalSwitch, oldBranch, realChange, swap, oldSourceDom, newSourceDom,
    released: [store.active.size, second.active.size]};
}
class ManualThrottle extends ComponentUpdateThrottle {
  setupTimeout() {}
  flush() { this.letsUpdate(); }
}
async function waveLane(deferred) {
  const scheduler = deferred ? new ManualThrottle() : undefined;
  const a = new Store({n: 1}, scheduler), b = new Store({n: 1}, scheduler);
  const left = computed(read => read(a).n), right = computed(read => read(b).n);
  const sum = computed(read => read(left) + read(right));
  const delivered = []; const id = sum.subscribe(() => delivered.push(sum.get()));
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); let renders = 0;
  function View() { renders++; return h('p', null, useComputedValue(sum)); }
  await React.act(async () => root.render(h(View)));
  const initial = {dom: container.textContent, renders, delivered: [...delivered]};
  await React.act(async () => transaction(() => {
    a.edit(d => { d.n = 2; }); b.edit(d => { d.n = 3; });
  }));
  const beforeFlush = {dom: container.textContent, renders, delivered: [...delivered]};
  if (deferred) await React.act(async () => scheduler.flush());
  const afterFlush = {dom: container.textContent, renders, delivered: [...delivered], value: sum.get()};
  await React.act(async () => root.unmount()); sum.unsubscribe(id); container.remove();
  return {deferred, initial, beforeFlush, afterFlush, released: [a.active.size, b.active.size]};
}
function cancellation() {
  const scheduler = new ManualThrottle(); const events = [];
  scheduler.schedule('first', () => { events.push('first'); scheduler.cancel('old'); scheduler.schedule('old', () => events.push('new')); });
  scheduler.schedule('old', () => events.push('obsolete'));
  scheduler.schedule('other', () => events.push('other'));
  scheduler.flush();
  return events;
}
(async () => {
  console.log(JSON.stringify({node: process.version, react: React.version}));
  for (const kind of ['stable-hook', 'inline-hook', 'class-selection']) console.log(JSON.stringify(await renderLane(kind)));
  console.log(JSON.stringify(await waveLane(false)));
  console.log(JSON.stringify(await waveLane(true)));
  console.log(JSON.stringify({cancellation: cancellation()}));
  dom.window.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
```

Точная выполненная команда:

```sh
node worktrees/r42-react-api-controls.cjs
```

Observed stdout:

```json
{"node":"v24.12.0","react":"19.3.0"}
{"kind":"stable-hook","parents":{"renders":6,"children":0,"selections":0,"adds":0,"drops":0,"readCalls":0},"unread":{"renders":0,"children":0,"selections":0,"adds":0,"drops":0,"readCalls":0},"equalSwitch":{"renders":0,"children":0,"selections":1,"adds":1,"drops":1,"readCalls":0},"oldBranch":{"renders":0,"children":0,"selections":0,"adds":0,"drops":0,"readCalls":0},"realChange":{"renders":1,"children":1,"selections":1,"adds":0,"drops":0,"readCalls":0,"dom":"3"},"swap":{"dom":"10","oldActive":0,"newActive":1},"oldSourceDom":"10","newSourceDom":"11","released":[0,0]}
{"kind":"inline-hook","parents":{"renders":6,"children":0,"selections":6,"adds":0,"drops":0,"readCalls":0},"unread":{"renders":0,"children":0,"selections":0,"adds":0,"drops":0,"readCalls":0},"equalSwitch":{"renders":0,"children":0,"selections":1,"adds":1,"drops":1,"readCalls":0},"oldBranch":{"renders":0,"children":0,"selections":0,"adds":0,"drops":0,"readCalls":0},"realChange":{"renders":1,"children":1,"selections":2,"adds":0,"drops":0,"readCalls":0,"dom":"3"},"swap":{"dom":"10","oldActive":0,"newActive":1},"oldSourceDom":"10","newSourceDom":"11","released":[0,0]}
{"kind":"class-selection","parents":{"renders":6,"children":0,"selections":6,"adds":0,"drops":0,"readCalls":0},"unread":{"renders":0,"children":0,"selections":0,"adds":0,"drops":0,"readCalls":0},"equalSwitch":{"renders":0,"children":0,"selections":1,"adds":1,"drops":0,"readCalls":0},"oldBranch":{"renders":0,"children":0,"selections":0,"adds":0,"drops":0,"readCalls":0},"realChange":{"renders":1,"children":1,"selections":2,"adds":0,"drops":0,"readCalls":0,"dom":"3"},"swap":{"dom":"10","oldActive":0,"newActive":1},"oldSourceDom":"10","newSourceDom":"11","released":[0,0]}
{"deferred":false,"initial":{"dom":"2","renders":1,"delivered":[]},"beforeFlush":{"dom":"5","renders":2,"delivered":[5]},"afterFlush":{"dom":"5","renders":2,"delivered":[5],"value":5},"released":[0,0]}
{"deferred":true,"initial":{"dom":"2","renders":1,"delivered":[]},"beforeFlush":{"dom":"2","renders":1,"delivered":[]},"afterFlush":{"dom":"5","renders":2,"delivered":[5],"value":5},"released":[0,0]}
{"cancellation":["first","other","new"]}
```

## Evidence limits и передача интегратору

- Здесь **не запускались** build, typecheck, lint, test runner, formatter, full benchmarks, GC/heap sweep, packed consumer matrix, React 18, real browser, production React, SSR/hydration или network/CI rerun. Tiny runtime probes выше — единственная executed behavioral evidence этого slice.
- Все значения render/subscribe/read счетчиков — операции через public seams конкретного workload; это не total allocated bytes и не универсальная асимптотика всей React операции.
- Scope/ergonomics/type/throwing-cleanup выводы — static contract review с прочитанными существующими tests, не дополнительные runtime success claims.
- Форматная проверка охватила `cjs/cjs`, `esm/cjs`, `cjs-prod/esm-prod`; это не полная 16-cell matrix. StrictMode использовал development React. Pending transition намеренно не разрешался: показаны удержание старого UI и cancel, а successful resume — будущий adversarial gate.
- Proposed correction и benchmark не реализованы. До реализации не утверждать, что R42-A01 устранен; воспроизводимый failing current baseline должен остаться отрицательным контролем.
- Orchestrator может независимо исполнить обе перечисленные Node-команды на supplied baseline. После реализации ему следует проверить новый real-transition gate на React 18/19 и старые перечисленные tests/perf/consumer gates в едином verification pass. Дополнительный heavy sweep в этом review не требовался и не запускался.

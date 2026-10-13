# Раунд 42 — selection / proxy / path-index / write-proof

Дата: **2026-10-10**. Reviewed base: **`fa1ad08f8cd6b26f175235a435976fcb9d94dd22`**.

Review-only: production, tests, benchmarks, config и версии не менялись. Исследование выполнено в `worktrees/review-r42-selection-20261010`, ветка `review-r42-selection-20261010`. Единственный tracked change — этот отчёт.

Границы: graph/flat reconciliation, read/write proxies, native aliases, patch planner, subscriber index, write-target ownership и transaction publication. Resource protocol и React commit scheduling не исследовались. Исполненные consumers — настоящий public `watch()` и public `subscribe()` через `Carburetor`; не изолированный заменитель алгоритма.

## Вывод

Две новые, source-backed находки производительности. Неверного результата в их воспроизведениях нет. Оптимизации **не реализованы**; latency speedup и экономия bytes не измерены и не обещаются.

| ID | Приоритет | Наблюдённая цена | Текущий источник | Evidence |
|---|---|---|---|---|
| **R42-S01** | P2 | Outside-only wake графового словаря строит `Object.keys(previous)` перед возвратом того же snapshot: 8 wakes перечисляют 128 / 1024 / 4096 ключей при ширине 16 / 128 / 512; только 16 tracked reads и 0 дополнительных deliveries во всех трёх случаях | `lib/src/Carburetor/Store/Utils/Selection/Patch/patchFromWriteLog.ts:12-16,51-59,71-86`; `Patch/planSelectionPatch.ts:33-43` | Реальная операция `watch` + exact enumeration/read/delivery counters; асимптотика — [INFERENCE] из источника |
| **R42-S02** | P2 | Одна публикация P sibling writes повторно сливает один и тот же ancestor bucket из N broad readers: P×N вызовов `matched.add(id)` ради N deliveries; P=N=64 даёт 4096 добавлений, 64 deliveries | `lib/src/Carburetor/Store/Paths/SubscriberIndex.ts:168-192,425-442`; `Store/Carburetor.ts:412-438` | Реальная операция `subscribe` + два независимых масштаба P/N, exact filtered `Set.add` counter, precision/value controls |

Приоритет P2 относится к устранимому scaling-члену в этих конкретных consumer shapes, не к доказанной задержке кадра. Нет утверждения, что любое selection или любая подписка имеет эту цену.

## R42-S01 — размер всего словаря вычисляется для плана без patch children

### Проблема и механизм

Валидный plain source tree: `{tick, box: {k0: {n}, k1: {n}, ...}}`. Selector читает `tick` как отдельную dependency и возвращает `d.box`. Такой selector намеренно reevaluate-ится при tick, но выбранный словарь не меняется. У графового, а не flat-primitive словаря есть copy ledger, поэтому callback идёт через `patchFromWriteLog` (`Tracking/Observation/watchSelection.ts:87-121`).

1. `pathsSince` возвращает outside-root путь `tick`.
2. На `patchFromWriteLog.ts:58` аргумент `shallowSize(previous)` вычисляется **до** planner. Для plain object это `Object.keys(previous).length`.
3. Planner на `planSelectionPatch.ts:43` пропускает этот путь: patch work и `children` отсутствуют, величина budget не использована.
4. Полный raw-target proof всё равно выполняется. Store-root target не входит в ledger selected `box`; на `patchFromWriteLog.ts:84` возвращается `previous`.

Это не полный reconciliation, не immutable outer-spine copy и не обход для alias proof: перечислен detached snapshot только ради неиспользованного числа. Snapshot identity действительно сохранилась: следующий related write передал в `previous` ровно ранее удержанный `held`.

### Наблюдение

Перед окном выполнен реальный leaf edit `k0.n = -1`, чтобы удерживать detached результат. Затем восемь `tick++` publications:

| Ширина box | `Object.keys` calls на словаре | Перечислено ключей | Tracked reads | Selector calls | Extra deliveries |
|---:|---:|---:|---:|---:|---:|
| 16 | 8 | 128 | 16 | 8 | 0 |
| 128 | 8 | 1024 | 16 | 8 | 0 |
| 512 | 8 | 4096 | 16 | 8 | 0 |
| Array control, 512 object rows | 0 | 0 | 16 | Не считались отдельно | 0 |

Счётчик считает реальные возвращённые ключи `Object.keys` у единственного fixture dictionary с первым ключом `k0`. Обёртка возвращает исходный результат без изменения поведения и снимается в `finally`. Read recorder и selector считаются отдельно. Array control не доказывает отсутствие любых аллокаций: для array `shallowSize` читает `length`, без перечисления ключей.

После окна `k0.n = -2` доставлен один раз; `before === held`, старое `held.k0.n === -1`, новое значение `-2`, неизменённый `k1` shared по identity. Итого цена наблюдается внутри успешной end-to-end операции, а не в отдельном синтетическом `Object.keys` loop.

[INFERENCE] При K таких wakes helper содержит O(K×N) enumeration work и K временных массивов ключей. Числа bytes, GC и время whole operation не измерялись. `readCoverage.extend` возвращает прежний filed set, когда scratch уже покрыт (`Paths/Markers/readCoverage.ts:74-82`), а `sameReads.ts:13-15` имеет identity fast path; размер retained read set сам по себе не оправдывает данное перечисление.

### Безопасное действие

Не вычислять точный shallow size, когда уже существующая классификация paths показывает отсутствие inside-root пути. Достаточен локальный boolean в текущем проходе, без persistent cache и без нового closure: для outside-only входа planner может использовать минимальный бюджет, поскольку не создаёт ни одного patch child. **Сам planner остаётся обязательным**: outside path может быть ancestor root и требовать fallback. Raw-target proof также остаётся обязательным перед reuse.

Для настоящих inside-root paths сохранить точный размер и нынешний relative budget. Не менять graph ledger, `allowPatch`, native exposure policy, completion или APIs. Общий helper также вызывается из `Patch/reuseSelection.ts:49-52` и `Interop/useCarburetorValue.ts:291-298`; распространение эффекта на эти routes — [INFERENCE], React-воспроизведение здесь не запускалось.

Tradeoff: убирается неиспользованное вычисление и его массив ключей, добавляется только локальная классификация. Содержательный inside patch по-прежнему может требовать O(width) immutable spine copy; это не новый finding и не цель данного предложения. Plain flat selections идут другим маршрутом, их ledger-free контракт R41 не расширяется.

### Инварианты и adversarial cases

- Reuse только для того же live view, корректного baseline и complete path history. Wildcard/root/ancestor write по-прежнему fallback.
- Outside path проверяется по **всем** накопленным raw targets; `RAW_EXPOSURE`, отсутствующий target, watermark/overflow запрещают reuse. Нельзя заменить ownership proof одним path-prefix сравнением.
- Outside in-place mutation объекта, достижимого через selected Map, должна обновить snapshot; replacement ordinary edge не должен перепривязать прежний Map member.
- Graph sharing/cycles нельзя частично patch-ить. `allowPatch=false` допускает прежний результат лишь после действительно disjoint proof, как сейчас.
- Inside `~k`, `~p`, `length`, object-valued leaf, own `__proto__` и dense budget fallback остаются прежними.
- Не нарушать sparse holes/own-undefined, prototype, readonly-by-contract snapshots и completed reads. Не поддерживать незаконные source plain cross-path aliases новым whole-source scan.

### Новый benchmark и старые gates

Предложить **`selection42/outside-dictionary@{16,128,512}`**, отдельно `watch`, hook и class routes: explicit tick dependency + stable direct graph dictionary; K=8, inside leaf edit до/после, held identity/value, unmodified branch sharing. Gate для будущей реализации: outside-only dictionary enumeration = 0, callbacks = 0, реальные leaf deliveries = 2. Измерять whole `update → capture/reuse → completion → delivery` до/после в отдельных процессах; wall-clock только после controls, без обещанного speedup.

Обязательные controls: array lane; inside dense batch; root/ancestor replacement; native alias and raw exposure; неизвестная attribution/overflow; sparse own-undefined. Старые защиты: `writelog39/interleaved-{watch,hook,class}`, `writelog39/paths-since`, `selection37/alias-topology`, `selection37/patch-budget`, `selection38/cyclic-equality`, `selection38/sparse-raw-cap`, `selection38/footprint-lifecycle`, `readset40/bound-class-work`. Coverage sources: `Selections/patching/watch-patching.test.ts`, `Selections/restore/writelog39/r39-ownership.test.ts`, `Paths/history/writelog39/target-coverage.test.ts`. Новый benchmark здесь не создан, старые gates здесь не запускались.

## R42-S02 — одинаковый ancestor bucket обходится заново для каждого sibling write

### Проблема и механизм

N public subscribers намеренно читают целую ветвь `box` через `{reads: ['box']}`. Ещё один precise subscriber читает `spare.n`, и отдельный wildcard subscriber читает все publications. В одном `update` меняются P разных `box.kI.n`; callbacks ничего не регистрируют и index во время match не меняется.

Для каждого write `SubscriberIndex.match` заново доходит до `exact['box']` (`:184-188`). Это **тот же** Set bucket из N id, но `collect` (`:436-437`) снова вызывает `forEach` и `matched.add` для всех N. Final matched Set подавляет повторные deliveries, не повторные обходы. `Carburetor` сначала полностью строит matched set и только затем schedules callbacks (`:418-438`).

### Наблюдение

Счётчик оборачивает `Set.prototype.add` только в synchronous write window и считает только ids с префиксом `R42-reader-`; path strings, wildcard/spare ids и engine scheduler keys исключены. Весь прежний `add` вызывается как есть.

| P writes | N broad readers | Candidate adds | Реальные broad deliveries |
|---:|---:|---:|---:|
| 4 | 4 | 16 | 4 |
| 16 | 4 | 64 | 4 |
| 4 | 16 | 64 | 16 |
| 16 | 16 | 256 | 16 |
| 64 | 64 | 4096 | 64 |

В каждой строке все изменённые rows получили `n === 1`; каждый broad subscriber вызван ровно один раз; `spare` вызван ноль раз; wildcard — один раз. Следующий отдельный `spare.n++` вызвал только precise spare и wildcard, не broad readers. Поэтому case не сводится к тривиальному early exit «все зарегистрированные subscribers уже matched»: unmatched subscriber сохраняется до конца первого match.

[INFERENCE] Именно shared-ancestor bucket добавляет O(P×N) работу, хотя его вклад в union равен N. Общие path lookup/depth и доставка N callbacks остаются необходимыми. При P≈N этот конкретный член квадратичен; это не утверждение о worst-case всех shaped read sets и не оценка milliseconds.

### Безопасное действие

Внутри одного `match` обходить повторно встреченный **тот же multi-id ancestor bucket** только при первом появлении. Локальное, ленивое visit bookkeeping для multi-write lane; не постоянный cache, не дополнительный индекс и не сортировка writes. Однопутевой lane не должен получать новую collection allocation. Singleton buckets и разные bucket identities не требуют нового сложного механизма.

Дедуплицировать обход, а не только добавление отдельных ids: `if (!matched.has(id))` внутри прежнего `forEach` оставляет O(P×N) visits и не решает finding. Сохранить порядок первого добавления id, чтобы не менять существующий delivery order. Wildcard route и registration/unregistration остаются прежними.

[INFERENCE] Для fixture возможно O(P×depth + N) вместо общего ancestor merge O(P×N). Tradeoff — match-local metadata и дополнительные membership checks на много-путевой lane; это может проиграть на маленьких или disjoint buckets, поэтому принимать реализацию только по whole-operation A/B плюс allocation counters. Нет обещания универсального ускорения и нет предложения сделать broad reads precise: их семантика намеренная.

### Инварианты и adversarial cases

- Union id тот же для exact / written ancestor / written descendant / wildcard cases, независимо от порядка writes.
- `joinPath` экранирует `.` и `~`; нельзя coalesce-ить lexical prefixes, не являющиеся настоящими ancestor paths.
- Dedup живёт только в одном match: следующий вызов обязан видеть refile/addPath/remove, promotion/demotion и branch reference counts.
- Index не должен менять public transferred-read ownership. Callback generation/reentrant scheduling checks в `Carburetor` не трогать.
- Родительский write и child write в одном Set, несколько разных ancestors с частично пересекающимися ids, wildcard plus exact, empty read set, и broad+precise registrations не должны терять доставку.
- Mixed transaction publications могут объединить тот же shaped write set (`Transaction/UpdateBatch.ts:58-68`); сам batching не устраняет повторение ancestor lookup. Runtime proof здесь — один public update, не отдельный запуск exported `transaction`.

### Новый benchmark и старые gates

Предложить **`subscribe42/common-ancestor`** с независимыми P/N axes (4/16/64), дополнительным unmatched precise subscriber и wildcard, подсчётом bucket member visits/filtered adds, final values и callbacks. Future gate после реализации: общий ancestor bucket посещён один раз, candidate broad adds = N, ни одной ложной/утерянной delivery. Сравнить whole mutation+publication+match+schedule до/после; отдельно single-write и disjoint-leaf controls для allocation/latency regression. Добавить shuffled writes, overlapping ancestors и refile/remove между окнами. Benchmark не создан.

Старые gates: `subscribe/match-precision@{100,1k,4k}`, `subscribe/refile-delta`, `subscribe/three-path-buckets`, `readset40/filed-paths`, `readset40/index-entries`. Existing differential/ownership coverage: `Paths/subscriberIndex.test.ts`, `Paths/subscriberIndexBranchCounts.test.ts`, `Paths/history/r40-02/index-equivalence.test.ts`. Нынешний `perf/scenarios/subscribe/match-precision.mjs:66-103` считает precise sibling deliveries, но не измеряет повторный shared broad-ancestor bucket: старый gate необходим, но недостаточен для этого finding.

## Rejected candidates, intentional floors и novelty

- **R39-01/R39-04 не переобъявляются.** Текущие `WriteLog.ts:100-146,310-355` индексируют recent paths и накопленные count-bounded targets; `WriteTargetLedger.ts:39-44` не пишет pairs без owner. Это не прежняя двух-publication ring. В bounded control отсутствие consumer и last dispose дают одинаковые Map/Set/WeakMap counts; related selection deliveries правильны. Default capacity 8192, publication 1024 unique pairs, accumulated 2048 и pending 4096 — conservative bounds, не обнаруженный баг.
- **R40 completion и iteration cutovers не переобъявляются.** S02 сохраняет законную broad `box` registration и касается повторного обхода одного bucket **в match**, а не лишних `~p` paths при filing. Ни возвращение redundant markers, ни удаление intentional coarse dependency не предлагаются. One-trap array iteration здесь не изменяется и не измеряется заново.
- **R41 direct-flat floor не finding.** `reconcileFlatSelection` primitive own-data path обходит graph ledgers; graph dictionary в S01 заведомо содержит nested object values и не подходит этому fast path. Удалять copy ledger из такого случая нельзя.
- **Не новая регрессия R41:** relative patch budget `max(shallowSize(previous), 16)` уже описан в resolution R37 (`round-37:367-369`). Новый consumer case S01 показывает цену eagerly computed размера на outside-only словаре, не отвергает relative budget. В R39/R40/R41 это не было finding; прежние array interleaving gates не перечисляют object keys.
- **Immutable spine и topology proofs необходимы.** `patchSelection.ts:16-19,48-55` копирует изменённый spine и отказывается patch-ить object-valued leaf. `reconcileSelection.ts:77-117,438-481` отслеживает pair topology/sharing; `detachCore.ts:54-76,141-197` сохраняет native/plain aliases и sparse representation. Без отдельного доказательства удаления эта работа не объявлена overhead.
- **Object-keyed native equality, positional/structural fallback и cyclic working set** — уже записанные ограничения (`round-39:60-66`, `round-37:39-43`), не новые IDs.
- **Native coarse boundary не новый correctness finding.** Ранняя форма control ошибочно требовала auto-delivery после `d.date.setTime(2000)` для Date, выбранной только через `node.link`. Получено `1 !== 2`: plain `peer` alias доставился, Date автоматически — нет. Текущий native alias recorder ищет ordinary trackable paths (`NativeAliasReads.ts:65-99`), не все opaque native-to-native aliases. В финальной пробе этот результат явно наблюдён как `rawDateAutoDeliveries: 0`; последующий **явно прочитанный** tick доставляет новый detached Date и сохраняет старую. Это соответствует уже ограниченному native coarse contract; похожий existing ownership control также использует tick (`r39-ownership.test.ts:29-45`). Не предлагается whole-source alias scan.
- **Unsupported objects не “ускоряются” unsafe копией.** Watch отклоняет custom class и Array subclass; primitive field projection остаётся рабочим. Source plain containers сохраняют TREE contract, selector-created sharing/cycles и native aliases — другой, поддержанный маршрут.
- **Cross-root alias cache и reflection-array floors** не исследованы как новые проблемы. `NativeAliasIndex.noteChange` работает с локальным ownership repair и lazy fallback, а `NativeAliasReads.isScalarLeaf` всё ещё использует reflection arrays; отсутствие Set constructors не значит zero-allocation.

## Дополнительные исполненные controls

`controls.mjs` выполнил только маленькие реальные runtime cases:

- Native/plain alias: outside `peer.n` edit обновляет selected Map member; old detached member сохраняет 1, новый — 2. Self backlink у всех endpoints указывает на свой snapshot. Outside replacement `peer = {n: 3}` не меняет member уже существующей Map. Date после explicit tick: 1000 → 2000, held 1000.
- Sparse array length 64: добавление own-undefined в hole и последующее delete — две различные deliveries; третий leaf edit сохраняет holes, length, old value и identity untouched row.
- Custom class / Array subclass selection отклоняются; scalar projection custom instance доставляет 2.
- Escaped `box.a~1b.n` и nested `box.a.b.n` не смешиваются; refile broad reader на `spare` и unsubscribe сохраняют точность.
- В трёх окнах по 8 warmed real writes constructor counters:

| Lane | Map | Set | WeakMap |
|---|---:|---:|---:|
| No consumer | 0 | 16 | 0 |
| Live graph watch | 16 | 24 | 0 |
| После dispose | 0 | 16 | 0 |

Live lane доставил 9 раз, включая warming edit, final source value после всех окон — 26. Counts — только constructors, не bytes и не heap-retention proof. Эта таблица является control реализованного opt-in/release, не новым finding о восьми дополнительных Sets.

## Воспроизводимость и evidence limits

### Identity и точные команды

Все команды ниже запускались с cwd `D:/dev/ReactCarburetor/worktrees/review-r42-selection-20261010`:

```text
git branch --show-current && git rev-parse HEAD && git status --short
node worktrees/r42-selection-probes/costs.mjs
node worktrees/r42-selection-probes/controls.mjs
```

Preflight: branch `review-r42-selection-20261010`, HEAD `fa1ad08f8cd6b26f175235a435976fcb9d94dd22`, status пустой. Последняя команда выполнена дважды: первоначальная ошибочная Date auto-delivery assertion завершилась `AssertionError: 1 !== 2` в `controls.mjs:20`; после уточнения fixture в соответствии с native coarse contract выполнено описанное выше отдельное explicit-tick наблюдение. Ни source, ни distribution для этого не менялись.

`dist` — read-only junction; исполнялся production ESM из `dist/esm-prod`, не TS и не другая сборка. `costs.mjs` напечатал realpath и SHA256 двух relevant compiled modules:

```json
{"node":"v24.12.0","v8":"13.6.233.17-node.37","dist":"D:\\dev\\ReactCarburetor\\worktrees\\bench-dist\\fa1ad08f8cd6\\esm-prod","patchSHA256":"be25105cc7f9a34ae3b51222cd84adc10821f8c1625c84493f6490dedb8f2f02","indexSHA256":"612a9b971b40af819b627ee11b24121ef8a506f2dbe722dd4ad108c6cc25b205"}
```

Compiled baseline identity supplied orchestrator: exactly reviewed SHA. Supplied authoritative GitHub CI **38075943238**, **GREEN 11/11**, относится к опубликованной базе; не выдаётся за запущенную этим review локальную проверку.

### Компактная исполняемая проба costs.mjs

Сохранена в ignored `worktrees/r42-selection-probes/costs.mjs`. Для независимого воспроизведения создать файл с этим содержимым в таком же worktree-relative месте и выполнить приведённую команду:

```js
import assert from 'node:assert/strict';
import {realpathSync, readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Carburetor} from '../../dist/esm-prod/Carburetor/index.mjs';
class Store extends Carburetor {
  recorded = 0;
  run(fn) { this.update(fn); }
  read(record) { return super.read(path => { this.recorded++; record(path); }); }
}
const dist = new URL('../../dist/esm-prod/', import.meta.url);
const hash = name => createHash('sha256').update(readFileSync(new URL(name, dist))).digest('hex');
console.log(JSON.stringify({node: process.version, v8: process.versions.v8,
  dist: realpathSync(dist), patchSHA256: hash('Carburetor/Store/Utils/Selection/Patch/patchFromWriteLog.mjs'),
  indexSHA256: hash('Carburetor/Store/Paths/SubscriberIndex.mjs')}));
const key = i => `k${i}`;
const enumeration = fn => {
  const original = Object.keys;
  let calls = 0, listed = 0;
  Object.keys = value => {
    const keys = original(value);
    if (keys[0] === 'k0') { calls++; listed += keys.length; }
    return keys;
  };
  try { fn(); } finally { Object.keys = original; }
  return {calls, listed};
};
for (const n of [16, 128, 512]) {
  const box = Object.fromEntries(Array.from({length: n}, (_, i) => [key(i), {n: i}]));
  const store = new Store({box, tick: 0});
  let selectorCalls = 0;
  const seen = [], before = [];
  const stop = store.watch(d => { selectorCalls++; void d.tick; return d.box; },
    (next, previous) => { seen.push(next); before.push(previous); });
  store.run(d => { d.box.k0.n = -1; });
  assert.equal(seen.length, 1);
  const held = seen[0];
  store.recorded = 0;
  const initialCalls = selectorCalls;
  const cost = enumeration(() => { for (let i = 0; i < 8; i++) store.run(d => { d.tick++; }); });
  assert.equal(seen.length, 1);
  assert.equal(held.k0.n, -1);
  const quiet = {n, ...cost, recorded: store.recorded, selectorCalls: selectorCalls - initialCalls,
    extraDeliveries: seen.length - 1};
  store.run(d => { d.box.k0.n = -2; });
  assert.equal(seen.length, 2);
  assert.equal(before[1], held);
  assert.equal(held.k0.n, -1);
  assert.equal(seen[1].k0.n, -2);
  assert.equal(seen[1].k1, held.k1);
  stop();
  console.log(JSON.stringify({dictionary: quiet, heldCorrect: true, leafCorrect: true, untouchedShared: true}));
}
{
  const store = new Store({box: Array.from({length: 512}, (_, i) => ({n: i})), tick: 0});
  let deliveries = 0;
  const stop = store.watch(d => { void d.tick; return d.box; }, () => { deliveries++; });
  store.recorded = 0;
  const cost = enumeration(() => { for (let i = 0; i < 8; i++) store.run(d => { d.tick++; }); });
  assert.equal(deliveries, 0);
  console.log(JSON.stringify({arrayControl: {n: 512, ...cost, recorded: store.recorded, deliveries}}));
  stop();
}
for (const [p, n] of [[4, 4], [16, 4], [4, 16], [16, 16], [64, 64]]) {
  const box = Object.fromEntries(Array.from({length: p}, (_, i) => [key(i), {n: 0}]));
  const store = new Store({box, spare: {n: 0}});
  const wakes = Array(n).fill(0);
  for (let i = 0; i < n; i++) store.subscribe(() => { wakes[i]++; },
    {id: `R42-reader-${i}`, reads: ['box']});
  let spareWakes = 0, wildcardWakes = 0;
  store.subscribe(() => { spareWakes++; }, {id: 'spare', reads: ['spare.n']});
  store.subscribe(() => { wildcardWakes++; }, {id: 'wildcard'});
  const original = Set.prototype.add;
  let candidateAdds = 0;
  Set.prototype.add = function(value) {
    if (typeof value === 'string' && value.startsWith('R42-reader-')) candidateAdds++;
    return original.call(this, value);
  };
  try { store.run(d => { for (let i = 0; i < p; i++) d.box[key(i)].n++; }); }
  finally { Set.prototype.add = original; }
  assert.ok(wakes.every(value => value === 1));
  assert.equal(spareWakes, 0);
  assert.equal(wildcardWakes, 1);
  assert.ok(Object.values(store.getData().box).every(row => row.n === 1));
  store.run(d => { d.spare.n++; });
  assert.ok(wakes.every(value => value === 1));
  assert.equal(spareWakes, 1);
  assert.equal(wildcardWakes, 2);
  console.log(JSON.stringify({matching: {p, n, candidateAdds, requiredDeliveries: n,
    preciseControls: true, valuesCorrect: true}}));
}
```

Actual stdout после identity line:

```jsonl
{"dictionary":{"n":16,"calls":8,"listed":128,"recorded":16,"selectorCalls":8,"extraDeliveries":0},"heldCorrect":true,"leafCorrect":true,"untouchedShared":true}
{"dictionary":{"n":128,"calls":8,"listed":1024,"recorded":16,"selectorCalls":8,"extraDeliveries":0},"heldCorrect":true,"leafCorrect":true,"untouchedShared":true}
{"dictionary":{"n":512,"calls":8,"listed":4096,"recorded":16,"selectorCalls":8,"extraDeliveries":0},"heldCorrect":true,"leafCorrect":true,"untouchedShared":true}
{"arrayControl":{"n":512,"calls":0,"listed":0,"recorded":16,"deliveries":0}}
{"matching":{"p":4,"n":4,"candidateAdds":16,"requiredDeliveries":4,"preciseControls":true,"valuesCorrect":true}}
{"matching":{"p":16,"n":4,"candidateAdds":64,"requiredDeliveries":4,"preciseControls":true,"valuesCorrect":true}}
{"matching":{"p":4,"n":16,"candidateAdds":64,"requiredDeliveries":16,"preciseControls":true,"valuesCorrect":true}}
{"matching":{"p":16,"n":16,"candidateAdds":256,"requiredDeliveries":16,"preciseControls":true,"valuesCorrect":true}}
{"matching":{"p":64,"n":64,"candidateAdds":4096,"requiredDeliveries":64,"preciseControls":true,"valuesCorrect":true}}
```

### Исполняемые ownership / path / lifetime controls

Сохранены в ignored `worktrees/r42-selection-probes/controls.mjs`; финальное исполненное содержимое:

```js
import assert from 'node:assert/strict';
import {Carburetor} from '../../dist/esm-prod/Carburetor/index.mjs';
class Store extends Carburetor { run(fn) { this.update(fn); } }
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
{
  const peer = {n: 1}, date = new Date(1000);
  const node = {n: 0, link: new Map()};
  node.link.set('self', node); node.link.set('peer', peer); node.link.set('date', date);
  const store = new Store({tick: 0, node, peer, date});
  const seen = [], before = [];
  const stop = store.watch(d => { void d.tick; return d.node; },
    (next, previous) => { seen.push(next); before.push(previous); });
  store.run(d => { d.tick++; });
  assert.equal(seen.length, 0);
  store.run(d => { d.peer.n = 2; });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].link.get('peer').n, 2);
  assert.equal(before[0].link.get('peer').n, 1);
  store.run(d => { d.date.setTime(2000); });
  const rawDateAutoDeliveries = seen.length - 1;
  assert.equal(rawDateAutoDeliveries, 0);
  store.run(d => { d.tick++; });
  assert.equal(seen.length, 2);
  assert.equal(seen[1].link.get('date').getTime(), 2000);
  assert.equal(before[1].link.get('date').getTime(), 1000);
  store.run(d => { d.peer = {n: 3}; d.tick++; });
  assert.equal(seen.length, 2);
  assert.equal(seen[1].link.get('peer').n, 2);
  for (const snapshot of [...seen, ...before]) assert.equal(snapshot.link.get('self'), snapshot);
  stop();
  console.log(JSON.stringify({nativeAliases: {deliveries: seen.length, selfCycles: true,
    outsideInPlaceObserved: true, outsideReplacementKeepsMapMember: true, detachedHistory: true,
    rawDateAutoDeliveries, explicitTickDateObserved: true}}));
}
{
  const rows = []; rows.length = 64; rows[0] = {n: 0}; rows[63] = {n: 63};
  const store = new Store({tick: 0, rows});
  const seen = [], before = [];
  const stop = store.watch(d => { void d.tick; return d.rows; },
    (next, previous) => { seen.push(next); before.push(previous); });
  store.run(d => { d.tick++; });
  assert.equal(seen.length, 0);
  store.run(d => { d.rows[7] = undefined; });
  assert.ok(has(seen[0], 7)); assert.equal(seen[0][7], undefined); assert.ok(!has(before[0], 7));
  store.run(d => { delete d.rows[7]; });
  assert.ok(!has(seen[1], 7)); assert.ok(has(before[1], 7));
  store.run(d => { d.rows[63].n = 64; });
  assert.equal(seen.length, 3); assert.equal(seen[2].length, 64);
  assert.equal(seen[2][63].n, 64); assert.equal(before[2][63].n, 63);
  assert.ok(!has(seen[2], 1)); assert.equal(seen[2][0], seen[1][0]);
  stop();
  console.log(JSON.stringify({sparse: {deliveries: seen.length, ownUndefinedThenHole: true,
    length: seen[2].length, leafCorrect: true, heldCorrect: true, untouchedShared: true}}));
}
{
  class Thing { n = 1; }
  class SpecialArray extends Array {}
  const store = new Store({thing: new Thing(), rows: new SpecialArray(1, 2)});
  assert.throws(() => store.watch(d => d.thing, () => {}), /watch\(\) cannot select a live/);
  assert.throws(() => store.watch(d => d.rows, () => {}), /watch\(\) cannot select a live/);
  let selected;
  const stop = store.watch(d => ({n: d.thing.n}), next => { selected = next.n; });
  store.run(d => { d.thing.n = 2; });
  assert.equal(selected, 2); stop();
  console.log(JSON.stringify({unsupported: {classRejected: true, arraySubclassRejected: true,
    scalarProjection: selected}}));
}
{
  const store = new Store({box: {'a.b': {n: 0}, a: {b: {n: 0}}}, spare: 0});
  let escaped = 0, nested = 0, broad = 0;
  store.subscribe(() => { escaped++; }, {id: 'escaped', reads: ['box.a~1b.n']});
  store.subscribe(() => { nested++; }, {id: 'nested', reads: ['box.a.b.n']});
  store.subscribe(() => { broad++; }, {id: 'broad', reads: ['box']});
  store.run(d => { d.box['a.b'].n++; });
  assert.equal(escaped, 1); assert.equal(nested, 0); assert.equal(broad, 1);
  store.subscribe(() => { broad++; }, {id: 'broad', reads: ['spare']});
  store.run(d => { d.box.a.b.n++; });
  assert.equal(escaped, 1); assert.equal(nested, 1); assert.equal(broad, 1);
  store.run(d => { d.spare++; }); assert.equal(broad, 2);
  store.unsubscribe('broad');
  store.run(d => { d.spare++; }); assert.equal(broad, 2);
  console.log(JSON.stringify({pathControls: {escaped, nested, broad, refileAndRemoveCorrect: true}}));
}
const constructors = fn => {
  const originals = {Map: globalThis.Map, Set: globalThis.Set, WeakMap: globalThis.WeakMap};
  const counts = {Map: 0, Set: 0, WeakMap: 0};
  for (const name of Object.keys(originals)) globalThis[name] = new Proxy(originals[name], {
    construct(target, args, newTarget) { counts[name]++; return Reflect.construct(target, args, newTarget); },
  });
  try { fn(); } finally { for (const name of Object.keys(originals)) globalThis[name] = originals[name]; }
  return counts;
};
{
  const store = new Store({rows: [{n: 0}]});
  store.run(d => { d.rows[0].n++; });
  const writes = () => { for (let i = 0; i < 8; i++) store.run(d => { d.rows[0].n++; }); };
  const noConsumer = constructors(writes);
  let deliveries = 0, latest;
  const stop = store.watch(d => d.rows, next => { deliveries++; latest = next; });
  store.run(d => { d.rows[0].n++; });
  const withConsumer = constructors(writes);
  assert.equal(deliveries, 9); assert.equal(latest[0].n, 18);
  stop();
  const afterDispose = constructors(writes);
  assert.equal(deliveries, 9); assert.equal(store.getData().rows[0].n, 26);
  console.log(JSON.stringify({proofLifetime: {writesPerWindow: 8, noConsumer, withConsumer,
    afterDispose, deliveries, final: store.getData().rows[0].n}}));
}
```

Actual stdout финальной controls command:

```jsonl
{"nativeAliases":{"deliveries":2,"selfCycles":true,"outsideInPlaceObserved":true,"outsideReplacementKeepsMapMember":true,"detachedHistory":true,"rawDateAutoDeliveries":0,"explicitTickDateObserved":true}}
{"sparse":{"deliveries":3,"ownUndefinedThenHole":true,"length":64,"leafCorrect":true,"heldCorrect":true,"untouchedShared":true}}
{"unsupported":{"classRejected":true,"arraySubclassRejected":true,"scalarProjection":2}}
{"pathControls":{"escaped":1,"nested":1,"broad":2,"refileAndRemoveCorrect":true}}
{"proofLifetime":{"writesPerWindow":8,"noConsumer":{"Map":0,"Set":16,"WeakMap":0},"withConsumer":{"Map":16,"Set":24,"WeakMap":0},"afterDispose":{"Map":0,"Set":16,"WeakMap":0},"deliveries":9,"final":26}}
```

### Что не проверено исполнением

- Ни build, ни suite, lint, typecheck, formatter, full perf sweep, packed matrix, browser, GC/heap/stress не запускались. Current shared dist не пересобирался и не изменялся.
- Definitions/references изучены через source reads/grep: `xd://lsp` недоступен (`No such tool`, mounted devices — ast_edit/debug). Отсутствие LSP не заменено неподтверждёнными hover/type claims.
- Hook/class распространение S01, shuffled/overlapping match buckets, prefix adversaries с `~`, reentrant publication, ownership overflow, selector-created non-enumerable sparse indices, null-prototype arrays и cycle equality во всём пространстве — здесь только source/existing coverage review, не новые выполненные проверки.
- Находки доказаны bounded counters до 512 dictionary keys и 64×64 write/reader shape. Extrapolation к 10k и будущая latency/byte экономия — **unverified**. Before/after whole-operation измерения отсутствуют.
- Для реализации orchestrator должен сохранить указанные existing gates и добавить новые shape-specific counters. Возможные focused проверки после реализации: `npm run bench -- --dist dist/esm-prod --only selection38 --runs 3`, аналогично `writelog39`, `readset40`, `subscribe`; они **не запускались** в этом review. Полные tests/build/lint остаются задачей integration owner, не evidence этого отчёта.

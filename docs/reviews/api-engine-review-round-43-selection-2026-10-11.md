# Раунд 43 — Store: selection, paths, transactions и history

> Примечание: машинно-зависимые пути нормализованы: `.` обозначает корень репозитория,
> `<temp>` — временный каталог. Остальные данные исторического отчёта сохранены.

Дата: **2026-10-11**. Reviewed base: **`90a1c6041c2d33d3e9d307a79856deb67a9a67db`**, завершённая реализация R42. Исполнитель: **xxs / R43Selection**. Worktree и branch: `worktrees/review-r43-selection-20261011` / `review-r43-selection-20261011`.

Review-only. Единственный изменяемый файл — этот отчёт. Production, tests, benchmarks, конфигурация, зависимости и версии намеренно не изменены; implementation и push отсутствуют. Runtime, build, tests, lint, formatters, GC/heap и timing probes **мною не запускались**. Все прогнозы результатов и сложности ниже — **[INFERENCE] из текущего source**, а не измерения. Parent сообщил о готовых immutable bundles `worktrees/bench-dist/90a1c6041c2d/{esm,esm-prod,cjs,cjs-prod}`; это supplied provenance, не моя проверка сборки. `xd://lsp` недоступен: mounted devices — только `ast_edit`, `debug`; символы/callers прослежены чтением source.

Scope: публичные `read`, `watch`, `subscribe`, `setData`, `snapshot`, `restore`, protected `update` через обычный subclass; filing/matching, write proofs, snapshot reconciliation, transaction publication, history admission/cancellation/replay и native alias ownership. React scheduling и resource lifecycle не исследовались. Прочитаны R42 overview **включая Resolution**, тематический selection report, R41 rejected flat candidates и относящиеся R30–R40 history/alias limits.

## Вывод

| ID | Приоритет / тип | Source-backed механизм | Runtime status |
|---|---|---|---|
| **R43-S01** | **P1, correctness** | SameValue leaf verdict теряется на следующих `===`/`!==` gates: signed-zero change может не доставиться, equal `NaN` — доставиться лишний раз. Это относится и к scalar `watch`, и к нескольким graph containers | Не исполнен; проба S01 сравнивает raw state, deliveries и history с независимым flat control |
| **R43-S02** | **P2, аналитическая quadratic work** | Каждый scalar patch просматривает все предыдущие scalar patches, хотя ни один не может быть fold target: P(P−1)/2 проверок одного batch | Не исполнен; проба S02 считает actual patch-field reads, отдельно от wall-clock |
| **R43-S03** | **P2, аналитическая retention** | Alias-answer cache с weak native key хранит **strong root**. Удержанный обычный Date без backlink может удерживать весь уже заменённый plain root | Не исполнен; проба S03 содержит no-read/strong/overwrite controls и precision checks |

P1 следует проверять первым: уменьшение renders не должно оставлять старое значение. P2 не означает измеренных миллисекунд, allocated bytes или доказанной утечки после GC. Нет нового пользовательского performance knob: все три направления внутренние.

## R43-S01 — SameValue verdict не проходит через change gates

### Достижимая операция и механизм

Обычный subclass вызывает `this.update(d => { d.value = -0; })`; consumer использует `store.watch(d => d.value, callback)`. Write trap корректно отличает `+0` от `-0` через `Object.is` (`Tracking/createWriteProxy.ts:333–338,411–421`), а primitive reconcile тоже корректен (`Utils/Selection/reconcileSelection.ts:447–451`). Но `Tracking/Observation/watchSelection.ts:109,124–137` решает `changed` через **`next !== previous`**. Для signed zeros это false: callback не вызывается и `previous` не продвигается. Для `NaN` это true даже после возврата прежнего primitive baseline.

Есть второй слой того же рассогласования: primitive **content**, а не только object identity, сравнивается reference-style gates внутри graph reconciliation:

- `Utils/Selection/Patch/patchSelection.ts:62–65`: `next === before[key]` подавляет signed-zero patch; equal `NaN` вызывает ненужный `cloneSpine`.
- `Utils/Selection/reconcileSelection.ts:205–217`: keyed field `childResult !== found.value`.
- Там же `:328–333,382–385`: dense и sparse array slots.
- `Utils/Selection/reconcileCollections.ts:53–59,77`: **Map values**; keys отдельно используют правильный `sameValueZero` (`:21–22,44–45`).

**[INFERENCE]** Для `watch(d => d.box)` над `{box: {n: +0, keep: {tag: 1}}}` complete write log выбирает leaf patch и может вернуть старый snapshot с `+0` при raw `-0`. Fresh nested projection идёт через full keyed reconcile и имеет аналогичный content gate. Поэтому отключить patch route — не полный fix. Scalar и flat primitive object — разные lanes: flat helper сравнивает поля через `Object.is` (`reconcileFlatSelection.ts:37–43`) и возвращает новый container при смене знака; его identity проходит outer watch gate.

Equal-NaN wake в пробе — реальная отменённая операция `NaN → 1 → NaN` в одном `update`, а не недопустимая raw mutation: path записан, но final selection не изменилась. **[INFERENCE]** Scalar watch и graph route дадут лишнюю delivery; flat control останется silent. Стоимость лишнего graph spine copy — O(ширины копируемого spine), но ни объём bytes, ни время здесь не измерены.

### Безопасное направление и coverage

Использовать SameValue на **content/change gates**, включая outer watch verdict и поля/slots/Map values; для object references `Object.is` сохраняет прежний identity смысл. Не выполнять глобальную замену topology/reference/key comparisons. **Map/Set keys/members остаются SameValueZero**; object-key conservative policy, graph pair bijection, cycle remap, class rejection, sparse hole vs own-undefined, `__proto__`, raw-target proof и object-valued patch fallback не меняются. Не лечить special-case только `-0`, новым comparator API или wildcard wake.

Existing tests: `Selections/restore/r38-flat.test.ts:68–76` защищает signed zero **только flat tuple**; `HistoryScalarCancellation.test.ts:103–130` — numeric history. `Selections/patching/hook-patching-fuzz.test.tsx:87–140` и `watch-patching.test.ts:40–107` защищают общую patch/full эквивалентность, но в просмотренных cases нет numeric graph/outer-watch matrix. R11-07 касался resource view validation, R31-05 — Invalid Date timestamp; это не те gates.

Proposed permanent family **`selection43/same-value`**: scalar/flat/keyed/fresh projection/dense/sparse/Map-value; `+0→-0`, `-0→+0`, canceled NaN, finite change, genuine no-op. Gates: SameValue каждого delivered value, exact deliveries, held previous value, no unmatched subscriber wake, raw/history endpoints. После correctness — отдельный uninstrumented whole-operation lane для equivalent-NaN wakes и actual spine-copy counter с positive finite edit. Дополнительно parent должен проверить hook/class consumers этого shared helper на actual committed DOM, не фиксируя speculative render counts. Confidence по gates высокая; runtime reachability и format parity остаются проверкой parent.

### Проба S01 — `r43-selection-s01.mjs`

Полностью самостоятельная ESM-проба. `DIST_ROOT` или первый argv — **конкретная format directory**, как у existing `resource42/fixture.mjs`; `.mjs`/`.js` выбираются по существующим файлам. Она не утверждает ожидаемый defect заранее: печатает discrepancies, но жёстко проверяет raw writes, независимый flat/finite/empty controls, sparse shape и history endpoints.

```js
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root = resolve(process.env.DIST_ROOT ?? process.argv[2] ?? 'dist/esm-prod');
const require = createRequire(import.meta.url);
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
const {Carburetor, CarburetorHistory} = await importPart(root, 'Carburetor');
class Store extends Carburetor { run(fn) { this.update(fn); } }
const label = x => Number.isNaN(x) ? 'NaN' : Object.is(x, -0) ? '-0' : String(x);
function lane(kind, phase, start, finish) {
  let box = {n: start, keep: {tag: 1}};
  if (kind === 'dense') box = [start, {tag: 1}];
  if (kind === 'sparse') {
    box = []; box.length = 8; box[3] = start; box[6] = {tag: 1};
  }
  if (kind === 'map') box = new Map([['n', start]]);
  const s = new Store({value: start, box, unread: {n: 0}});
  const h = new CarburetorHistory(s);
  const select = d => kind === 'scalar' ? d.value : kind === 'flat' ? {n: d.value}
    : kind === 'fresh' ? {row: {n: d.value}, keep: {tag: 1}} : d.box;
  const take = x => kind === 'scalar' ? x : kind === 'fresh' ? x.row.n
    : kind === 'dense' ? x[0] : kind === 'sparse' ? x[3]
    : kind === 'map' ? x.get('n') : x.n;
  const put = (d, n) => {
    if (['scalar', 'flat', 'fresh'].includes(kind)) d.value = n;
    else if (kind === 'dense') d.box[0] = n;
    else if (kind === 'sparse') d.box[3] = n;
    else if (kind === 'map') d.box.set('n', n);
    else d.box.n = n;
  };
  const raw = () => ['scalar', 'flat', 'fresh'].includes(kind) ? s.getData().value
    : kind === 'dense' ? s.getData().box[0] : kind === 'sparse' ? s.getData().box[3]
    : kind === 'map' ? s.getData().box.get('n') : s.getData().box.n;
  const reads = new Set(); void s.read(p => reads.add(p)).unread.n;
  let unrelated = 0;
  const id = s.subscribe(() => unrelated++, {reads});
  const events = [];
  const stop = s.watch(select, (next, previous) => events.push({next, previous}));
  try {
    s.run(d => { if (phase === 'equal-nan') put(d, 1); put(d, finish); });
    assert.ok(Object.is(raw(), finish), 'the write reached the real store');
    assert.equal(unrelated, 0);
    const expected = phase === 'empty' || phase === 'equal-nan' ? 0 : 1;
    const correct = events.length === expected && events.every(e =>
      Object.is(take(e.next), finish) && Object.is(take(e.previous), start));
    if (kind === 'flat' || phase === 'ordinary' || phase === 'empty') assert.ok(correct);
    if (kind === 'sparse') {
      assert.equal(s.getData().box.length, 8);
      assert.equal(Object.hasOwn(s.getData().box, 0), false);
      assert.equal(Object.hasOwn(s.getData().box, 3), true);
    }
    const result = {kind, phase, raw: label(raw()), expected, actual: events.length, correct,
      values: events.map(e => [label(take(e.previous)), label(take(e.next))])};
    if (expected === 1) {
      assert.equal(h.undo(), true); assert.ok(Object.is(raw(), start));
      assert.equal(h.redo(), true); assert.ok(Object.is(raw(), finish));
    } else assert.equal(h.canUndo(), false);
    return result;
  } finally { stop(); s.unsubscribe(id); h.disconnect(); }
}
const results = [];
for (const kind of ['scalar', 'flat', 'keyed', 'fresh', 'dense', 'sparse', 'map']) {
  for (const [phase, a, b] of [['forward', +0, -0], ['reverse', -0, +0],
    ['equal-nan', NaN, NaN], ['ordinary', 1, 2], ['empty', 2, 2]]) {
    results.push(lane(kind, phase, a, b));
  }
}
console.log(JSON.stringify({root, format: bundleFormat(root), results,
  discrepancies: results.filter(x => !x.correct)}));
```

## R43-S02 — scalar batch quadratic folding search без возможного target

### Механизм, цена и безопасный fix

Достижимый consumer: history attached; один `update` пишет P existing numeric row leaves или `transaction` объединяет P отдельных методов. Mutation-time patches собираются до publication (`CarburetorHistory.ts:97–100,263–289`; `UpdateBatch.ts:58–68`; `Carburetor.ts:433`). Scalar branch **безусловно** вызывает `foldDependentPatch(pendingPatches, patch)`.

`Tooling/Graph/foldDependentPatch.ts:18–22` идёт назад по каждому предыдущему record. Но fold candidate обязан иметь `isTrackable(earlier.next)`. У всех предыдущих records нашего scalar-only batch `next` — number: каждый отклоняется, новый patch добавляется. **[INFERENCE]** При фиксированной глубине пути точное число earliest `nextExists` probes — `0+1+…+(P−1) = P(P−1)/2`; 8/32/64 patches означают 28/496/2016 таких проверок. History `limit=50` ограничивает entries, **не P внутри entry**. Общий hot path нельзя называть O(patches) только на основании того, что baseline replay линейный.

Безопасное простое направление: publication-local флаг «среди pending patches может быть owned trackable next». Пока он false, fold поиск заведомо невозможен и не вызывается. Установить его при добавлении соответствующего owned endpoint; консервативно оставшийся true безопасен. Reset должен следовать всем существующим границам record/clear/replay suppression. Нельзя пропустить поиск после object insertion/replacement: subsequent descendant patch обязан продвинуть owned `next`, не raw endpoint. Не нужны generic trie, новая Map на каждый scalar batch или новый public history API. **[INFERENCE]** Для scalar-only fixture поисковый член исчезает, остаётся необходимая O(P×path depth) recording/cancellation/install work; wall-clock gain неизвестен.

`foldDependentPatch.ts:28–30` также создаёт suffix `slice` перед barrier check, но это **не участвует** в данном scalar-only finding: здесь candidate вообще не найден. Смешанный object/scalar batch остаётся отдельным conservative control, а не заявленным linear worst case.

### Coverage и permanent benchmark

`CarburetorHistoryPatches.test.ts:78–146,377–399` защищает dependent owned endpoints и coalescing; `HistoryScalarCancellation.test.ts:37–100` — cancellation/redo. Existing `history31/scalar-cancellation@{32,512}` меняет **размер unrelated state**, не P (`perf/gates/history31.mjs:7–21`); `history39/scale` делает отдельные publications и one-leaf replay (`perf/scenarios/history39/scale.mjs:44–61`). Это необходимые, но не quadratic batch counters.

Proposed family **`history43/scalar-batch@{1,8,32,64,256}`**: axes P и unrelated state size раздельно; one-update/transaction/manual-throttle coalescing против separate publications. Actual fold probes должны быть 0 на scalar-only lane после fix, positive hook=1, empty=0; один undo отменяет весь coalesced batch, cancellation сохраняет redo, unrelated subscriber silent. Object insertion + descendant change, intermediate replacement barrier, native/restricted/sparse fallback, independent histories и reentrant publication — correctness controls. Timing: отдельные **неинструментированные** completed update+publication windows, не время getter instrumentation. Confidence по analytical loop высокая; возможный disprover — иной actual patch shape, ранний opaque route или bundle mismatch, поэтому snippet проверяет patch entry/count и endpoints.

### Проба S02 — `r43-selection-s02.mjs`

Прозрачные getters ставятся **на настоящие scalar patch records** только для подсчёта accesses в `super.onPatch`, затем исходные descriptors восстанавливаются. Это не mock source, не alternative folding implementation и не allocated-byte measurement. Derived history subclass использует существующий protected override pattern.

```js
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root = resolve(process.env.DIST_ROOT ?? process.argv[2] ?? 'dist/esm-prod');
const require = createRequire(import.meta.url);
function bundleFormat(root) {
  if (existsSync(resolve(root, 'Carburetor/index.mjs'))) return 'esm';
  assert.ok(existsSync(resolve(root, 'Carburetor/index.js'))); return 'cjs';
}
function importPart(root, part) {
  return bundleFormat(root) === 'cjs'
    ? Promise.resolve(require(resolve(root, part, 'index.js')))
    : import(pathToFileURL(resolve(root, part, 'index.mjs')).href);
}
const {Carburetor, CarburetorHistory, transaction} = await importPart(root, 'Carburetor');
class Store extends Carburetor { run(fn) { this.update(fn); } }
class MeterHistory extends CarburetorHistory {
  gate = false; checks = 0; taps = [];
  onPatch(patch) {
    if (typeof patch !== 'symbol' && (patch.previous === null || typeof patch.previous !== 'object')
      && (patch.next === null || typeof patch.next !== 'object')) {
      const descriptor = Object.getOwnPropertyDescriptor(patch, 'nextExists');
      assert.ok(descriptor && 'value' in descriptor);
      const owner = this;
      Object.defineProperty(patch, 'nextExists', {enumerable: descriptor.enumerable,
        configurable: descriptor.configurable, get() {
          if (owner.gate) owner.checks++; return descriptor.value;
        }});
      this.taps.push([patch, descriptor]);
    }
    this.gate = true;
    try { return super.onPatch(patch); } finally { this.gate = false; }
  }
  restoreTaps() {
    for (const [patch, descriptor] of this.taps) Object.defineProperty(patch, 'nextExists', descriptor);
    this.taps = [];
  }
  last() { return this.past.at(-1); }
}
function run(n, mode) {
  const s = new Store({rows: Array.from({length: n}, () => ({n: 0})), spare: {n: 0}});
  const h = new MeterHistory(s, {limit: n + 2});
  let all = 0, precise = 0, unrelated = 0;
  const reads = new Set(); void s.read(p => reads.add(p)).rows[0].n;
  const spareReads = new Set(); void s.read(p => spareReads.add(p)).spare.n;
  const ids = [s.subscribe(() => all++), s.subscribe(() => precise++, {reads}),
    s.subscribe(() => unrelated++, {reads: spareReads})];
  const sum = () => s.getData().rows.reduce((total, row) => total + row.n, 0);
  try {
    if (mode === 'one-update') s.run(d => { for (const row of d.rows) row.n = 1; });
    else {
      const write = () => { for (let i = 0; i < n; i++) s.run(d => { d.rows[i].n = 1; }); };
      if (mode === 'transaction') transaction(write); else write();
    }
    const checks = h.checks;
    assert.equal(sum(), n); assert.equal(unrelated, 0); assert.equal(precise, 1);
    assert.equal(all, mode === 'separate' ? n : 1);
    const publication = {all, precise, unrelated};
    assert.equal(h.last().kind, 'patches');
    assert.equal(h.last().patches.length, mode === 'separate' ? 1 : n);
    h.checks = 0; s.run(d => { d.rows[0].n = 1; });
    const empty = h.checks; assert.equal(empty, 0);
    h.gate = true;
    try { void h.last().patches[0].nextExists; } finally { h.gate = false; }
    const positive = h.checks; assert.equal(positive, 1);
    h.restoreTaps();
    const steps = mode === 'separate' ? n : 1;
    for (let i = 0; i < steps; i++) {
      assert.equal(h.undo(), true); assert.equal(sum(), mode === 'separate' ? n - i - 1 : 0);
    }
    assert.equal(h.undo(), false);
    for (let i = 0; i < steps; i++) assert.equal(h.redo(), true);
    assert.equal(sum(), n); assert.equal(h.redo(), false);
    return {n, mode, checks, analytical: mode === 'separate' ? 0 : n * (n - 1) / 2,
      empty, positive, publication};
  } finally { h.restoreTaps(); h.disconnect(); ids.forEach(id => s.unsubscribe(id)); }
}
const results = [];
for (const n of [1, 8, 32, 64]) {
  for (const mode of ['one-update', 'transaction', 'separate']) results.push(run(n, mode));
}
// Owned-object folding must still happen when a real candidate exists.
const s = new Store({slot: null, keep: {n: 7}}), h = new CarburetorHistory(s);
try {
  s.run(d => { d.slot = {n: 1}; d.slot.n = 2; });
  assert.equal(h.undo(), true); assert.equal(s.getData().slot, null);
  assert.equal(h.redo(), true); assert.equal(s.getData().slot.n, 2);
  assert.equal(s.getData().keep.n, 7);
} finally { h.disconnect(); }
console.log(JSON.stringify({root, format: bundleFormat(root), results, ownedFoldControl: true}));
```

## R43-S03 — native alias answer удерживает посторонний obsolete root

### Достижимая операция и ownership chain

Application удерживает маленький plain Date (например, дату последнего sync). Store содержит этот Date и unrelated rows. `store.read(record).stamp` — документированный extension API (`Models/Store.ts:79–87`); Date возвращается raw, а `createReadProxy.ts:348–359` вызывает `recordNativeAliasReads(root, date, record)`. После `store.setData({stamp: null, rows: [], marker: 1})` tracked view больше не используется; history/watch не подключены.

`Tracking/Aliases/NativeAliasReads.ts:7–14` хранит `WeakMap<native, {root, generation, wildcard, paths}>`, причём **root strong**. Даже negative scalar-leaf answer содержит root (`:56–61`). **[INFERENCE]** Пока caller удерживает Date, цепочка `module answers → live weak key → answer.root → old rows` сохраняется. У Date в этом fixture нет ни own object fields, ни backlink; caller не удерживает старый snapshot/read proxy/root. Root replacement инвалидирует обычный root-owned index (`Transaction/installState.ts:65–69`; `NativeAliasIndex.ts:23–25`), но не удаляет этот answer. Refresh выполняется лишь при следующем native read, который переписывает cache entry.

Это не known **cross-root alternating cache miss** R30/R31/R37: нужен только **один retiring root и один оставшийся native key**, без чередования читаемых stores. Не R38-02 copy-ledger retention: нет watch, detached selection или write-target owner. **[INFERENCE]** Один cached key может удерживать O(size old root) постороннего state; несколько удержанных keys из разных retired roots могут удерживать сумму этих графов. Это static strong edge, не моя GC/heap observation и не оценка bytes.

### Безопасное направление, риски и coverage

Сделать ownership root-first: например, `WeakMap<root, WeakMap<native, answerWithoutRoot>>`. Root identity задаётся outer weak key, generation/path/wildcard остаются в answer. Тогда externally retained native не делает root живым. Для native leaf нельзя ради cache lookup строить whole-root ownership index; negative answers по-прежнему generation-scoped. Альтернатива с weak root reference требует проверки supported Node/runtime floor и hot-read цены; root-first layout не требует нового публичного API или finalizer.

Tradeoff — additional root cache lookup/table при первом exposure; сравнить warmed leaf/native iteration и cheap scalar read controls, не объявлять улучшение общего CPU. Alias dependencies, hidden/symbol own-data, getter avoidance, root-backlink wildcard, moved/replaced ordinary aliases и incremental topology invalidation обязательны. Удалить cache или всегда считать native leaf disjoint было бы unsafe/дороже и не решало бы правильную задачу.

Existing `NativeAliasReadCache.test.ts:67–121` проверяет warm hits и precision; `NativeTopologyAliasCorrectness.test.ts:47–99` — refresh negative answer после topology и own native data; `perf/gates/aliases.mjs:7–37` — время/visits/values, **не retired-root liveness**. `cloneOwnedGraph.ts` и snapshot/history retention не заменяют такой gate: здесь никакого owned snapshot нет.

Proposed family **`aliases43/retired-root`** — isolated `--expose-gc` Node process, bounded Date/Map-member/custom opaque controls, live store после replacement, only caller-held native. WeakRefs на old root и unrelated payload; no-read empty control collectible, caller-held old root positive control live, cached-read case collectible после fix, same-native/new-root overwrite control collectible. При неколлектабельном empty control результат **неопределён**, а не library failure. Вне liveness window — настоящие alias/precision/getter checks; warmed uninstrumented read/iterate timing отдельно. Confidence в strong-edge mechanism высокая; GC verdict ниже confidence до parent execution: engine job lifetimes, accidentally held view/root и other retention paths могут исказить probe.

### Проба S03 — `r43-selection-s03.mjs`

Запускать только с `--expose-gc`. Setup синхронно возвращает только live current store, native, WeakRefs и явный strong control; `deref()` отсутствует внутри GC turns. 16 job boundaries — bounded observation, **не универсальное обещание срока GC**. Сначала controls; затем parent сопоставляет `cached` до/после overwrite. После будущего fix cached должен быть collectible уже до overwrite.

```js
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root = resolve(process.env.DIST_ROOT ?? process.argv[2] ?? 'dist/esm-prod');
const require = createRequire(import.meta.url);
function bundleFormat(root) {
  if (existsSync(resolve(root, 'Carburetor/index.mjs'))) return 'esm';
  assert.ok(existsSync(resolve(root, 'Carburetor/index.js'))); return 'cjs';
}
function importPart(root, part) {
  return bundleFormat(root) === 'cjs'
    ? Promise.resolve(require(resolve(root, part, 'index.js')))
    : import(pathToFileURL(resolve(root, part, 'index.mjs')).href);
}
const {Carburetor} = await importPart(root, 'Carburetor');
assert.equal(typeof global.gc, 'function', 'run with --expose-gc');
class Store extends Carburetor { run(fn) { this.update(fn); } }
function retire(mode) {
  const stamp = new Date(1000);
  const old = {stamp, rows: Array.from({length: 32}, (_, n) => ({n})), marker: 0};
  const s = new Store(old);
  if (mode !== 'cold') {
    const paths = new Set();
    assert.equal(s.read(p => paths.add(p)).stamp, stamp);
    assert.ok(paths.has('stamp'));
  }
  const weak = new WeakRef(old), payload = new WeakRef(old.rows);
  s.setData({stamp: null, rows: [], marker: 1});
  assert.equal(s.getData().stamp, null);
  return {s, stamp, weak, payload, strong: mode === 'strong' ? old : undefined};
}
const cold = retire('cold'), cached = retire('cached'), strong = retire('strong');
async function turns() {
  for (let i = 0; i < 16; i++) {
    await new Promise(resolve => setImmediate(resolve));
    global.gc();
    await new Promise(resolve => setImmediate(resolve));
  }
}
const alive = value => ({root: value.weak.deref() !== undefined, payload: value.payload.deref() !== undefined});
await turns();
const before = {cold: alive(cold), cached: alive(cached), strong: alive(strong)};
const controlsValid = !before.cold.root && !before.cold.payload && before.strong.root && before.strong.payload;
// Refresh exactly the same externally held native through an independent fresh live root.
cached.s.setData({stamp: cached.stamp, rows: [], marker: 2});
assert.equal(cached.s.read(() => {}).stamp, cached.stamp);
await turns();
const afterOverwrite = alive(cached);
assert.equal(cold.stamp.getTime(), 1000); assert.equal(cached.stamp.getTime(), 1000);
assert.equal(strong.strong.rows.length, 32);
// Precision: do not turn a cached negative Date answer into a permanent disjoint answer.
const date = new Date(2000), s = new Store({stamp: date, row: {n: 1}, unread: {n: 0}, padding: {n: 0}});
const paths = new Set();
const read = () => { paths.clear(); assert.equal(s.read(p => paths.add(p)).stamp, date); };
read(); assert.equal(paths.has('row'), false);
let getters = 0;
Object.defineProperty(date, 'edge', {value: s.getData().row, configurable: true});
Object.defineProperty(date, 'trap', {get() { getters++; return null; }, configurable: true});
read(); assert.equal(paths.has('row'), false);
s.run(d => { d.padding = {n: 1}; });
read(); assert.ok(paths.has('row')); assert.equal(getters, 0);
let wakes = 0;
const id = s.subscribe(() => wakes++, {reads: paths});
try {
  s.run(d => { d.unread.n++; }); assert.equal(wakes, 0);
  s.run(d => { d.row.n++; }); assert.equal(wakes, 1);
} finally { s.unsubscribe(id); }
console.log(JSON.stringify({root, format: bundleFormat(root), controlsValid, before, afterOverwrite,
  precisionWakes: wakes, getters, interpretation: controlsValid ? 'compare cached before/after' : 'inconclusive GC controls'}));
```

## Проверенные границы и отклонённые candidates

- **R42-S01/S02 не повторяются.** Outside-only plan уже не считает shallow size (`patchFromWriteLog.ts:52–61`), multi-write matching имеет lazy shared-bucket traversal dedup (`SubscriberIndex.ts:194–235`). Старые parent timing flags не доказательство новой регрессии.
- Inside tiny/canceled dictionary patch всё ещё считает size до planner. Это потенциальная lazy-budget opportunity, но отдельный ID не выдан: слишком близко к R42 enumeration topic и current `selection42` manifest намеренно имеет selected enumeration positive floor (`:15–16`). Требуется отдельный acceptance design, а не молчаливое ослабление старого gate.
- Immutable spine copy для настоящего changed graph, native/plain alias proofs, object-valued leaf fallback, opaque/restricted snapshot endpoints и per-history owned baseline не объявляются лишними. `snapshot()` сохраняет native refs по documented contract; это не cloneOwnedGraph history ownership.
- `past.shift()` O(limit) уже recorded limit R36 (`:404`), default 50; здесь не переобъявляется. Existing native scalar history admission и canceled existing-leaf proof R39/R31 сохранены; R43-S02 относится к **предшествующему fold scan**, не full-state capture.
- Single-root retention R43-S03 отделён от documented cross-root miss churn, raw native mutation visibility и state TREE contract. Root backlink намеренно удерживает root сам по себе и годится только как strong control, не как defect fixture.
- Не предлагается новый низкоуровневый consumer path API: текущие `watch` и `read(record)`/`subscribe({reads})` уже разделяют простой consumer и extension use case (`Models/Store.ts:97–111`). Simplification для найденных механизмов — убрать невозможный поиск/лишнее ownership, а не добавить публичные knobs или shim.

## Parent verification order и точные recipes

**Никакой код выше не исполнен мной.** Parent сохраняет три fenced blocks в собственные ignored scratch files с именами `r43-selection-s01.mjs`, `r43-selection-s02.mjs`, `r43-selection-s03.mjs`; в моей ветке таких файлов нет. Перед запуском используется immutable root, не пересборка shared dist. Пример PowerShell, одна команда за раз:

```powershell
$env:DIST_ROOT = './worktrees/bench-dist/90a1c6041c2d/esm-prod'
node r43-selection-s01.mjs
node r43-selection-s02.mjs
node --expose-gc r43-selection-s03.mjs
```

1. S01: raw/history/flat controls обязаны пройти; сравнить every phase discrepancies. Если source prediction не подтверждается, изучить actual returned snapshots/format до утверждения defect. После fix — discrepancies пусты. Numeric graph + scalar API correctness — раньше оптимизаций.
2. S02: сопоставить printed `checks` с analytical count, проверить separate/empty/positive/owned-fold controls. Никаких bytes/latency выводов из getter reads. После fix scalar coalesced checks должны быть 0, controls неизменны.
3. S03: сначала `controlsValid`; при false liveness окно inconclusive. При true сравнить cached root/payload before и after overwrite, затем precision/getter checks. Повторить отдельными processes; при неоднозначности heap retaining-path proof без предварительного `deref`.
4. Повторить serially с root suffixes `esm`, `cjs-prod`, `cjs`; argv вместо env также допустим: `node r43-selection-s01.mjs ./worktrees/bench-dist/90a1c6041c2d/esm`. CJS extension **`index.js`**, ESM **`index.mjs`**, loader взят из existing fixture convention. Не mix-ить module copies внутри одного source probe.
5. При последующей реализации main agent запускает affected selection/history/native-alias suites и единый existing+new benchmark runner. Existing `selection37`, `selection38`, `selection42`, `subscribe42`, `writelog39`, `readset40`, `history31`, `history39`, `aliases`, `alias39` contracts сохраняются. Whole-operation A/B и heap bytes — только отдельные наблюдения после correctness/counter controls; здесь они не заявлены.

## Raw-source citations

- [Watch verdict и publication](../../lib/src/Carburetor/Store/Tracking/Observation/watchSelection.ts#L87), [primitive SameValue](../../lib/src/Carburetor/Store/Utils/Selection/reconcileSelection.ts#L447), [keyed gate](../../lib/src/Carburetor/Store/Utils/Selection/reconcileSelection.ts#L205), [array gates](../../lib/src/Carburetor/Store/Utils/Selection/reconcileSelection.ts#L328), [patch gate](../../lib/src/Carburetor/Store/Utils/Selection/Patch/patchSelection.ts#L60), [Map-value gate](../../lib/src/Carburetor/Store/Utils/Selection/reconcileCollections.ts#L53), [flat control](../../lib/src/Carburetor/Store/Utils/Selection/reconcileFlatSelection.ts#L37).
- [Scalar history collection](../../lib/src/Carburetor/Tooling/CarburetorHistory.ts#L263), [fold scan](../../lib/src/Carburetor/Tooling/Graph/foldDependentPatch.ts#L17), [record/clear boundaries](../../lib/src/Carburetor/Tooling/CarburetorHistory.ts#L327), [transaction batching](../../lib/src/Carburetor/Store/Transaction/UpdateBatch.ts#L58), [draft patch delivery](../../lib/src/Carburetor/Store/Tracking/createWriteProxy.ts#L411).
- [Alias answer root ownership](../../lib/src/Carburetor/Store/Tracking/Aliases/NativeAliasReads.ts#L7), [negative answer](../../lib/src/Carburetor/Store/Tracking/Aliases/NativeAliasReads.ts#L56), [native read caller](../../lib/src/Carburetor/Store/Tracking/createReadProxy.ts#L348), [replacement invalidation](../../lib/src/Carburetor/Store/Transaction/installState.ts#L65), [weak root index](../../lib/src/Carburetor/Store/Tracking/Aliases/NativeAliasIndex.ts#L7), [weak development ledger](../../lib/src/Carburetor/Store/Tracking/Aliases/AliasLedger.ts#L214).
- [Public watch/read contract](../../lib/src/Carburetor/Models/Store.ts#L79), [snapshot vs owned graph](../../lib/src/Carburetor/Store/Utils/deepClone.ts#L3), [owned history capture](../../lib/src/Carburetor/Store/Utils/Graph/cloneOwnedGraph.ts#L18), [existing bundle loader](../../__tests__/Engine/Resource/ResourceCache/Views/resource42/fixture.mjs#L13), [completed R42 resolution](api-engine-review-round-42-2026-10-10.md#resolution--2026-10-11).

## Parent verification — 2026-10-11

Parent лично исполнил S01/S02/S03 в **esm-prod/esm/cjs-prod/cjs**: 12 serial Node
v24.12.0 processes, без artificial pressure. Все controls прошли; statements об отсутствии
author execution выше относятся к initial review phase, не к этой parent verification.
Исправления не реализованы.

- **S01:** по 35 cases и **18 discrepancies** на format. Scalar/keyed/fresh/dense/sparse/Map-value
  пропускают оба signed-zero changes и дают extra canceled-NaN delivery; flat, finite и
  no-op controls корректны. Raw/history endpoints, sparse holes и unrelated precision проходят.
- **S02:** one-update/transaction P=8/32/64 дают **28/496/2016** actual earlier-patch checks.
  Separate publication/empty — 0, positive — 1; complete undo/redo, restored descriptors,
  precise delivery и genuinely owned object+descendant folding проходят.
- **S03:** GC controlsValid=true во всех formats. Cold root/payload collectible; cached old
  root/payload live при externally held Date; strong control live. Same-native answer overwrite
  освобождает cached obsolete root/payload. Precision wakes 1, getter invocations 0.

Actual Chromium дополнительно подтвердил S01 visible effect: source/scalar hook/raw class
`-Infinity`, graph hook/selection class `Infinity` после `+0→-0`. Watch scalar/flat/graph
deliveries 0/1/0; finite-change control отображает `0.5` везде. Browser errors 0; own root,
tab и server освобождены.

Counts показывают конкретную устранимую работу; GC targets — ownership boundary. Ни bytes,
CPU instructions, throughput speedup, ни future fixed-suite pass не заявляются.
Raw receipts: `.rush/stdin/r43-ui-selection-probes.json`, `r43-browser-receipt.json`.
[Общий R43 отчёт](api-engine-review-round-43-2026-10-11.md) содержит complete scope/provenance.

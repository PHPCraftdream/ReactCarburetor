# API / engine review — раунд 43: Computed, capture и lifetime

Дата: **2026-10-11**. Reviewed base: **`90a1c6041c2d33d3e9d307a79856deb67a9a67db`**. Исполнитель: **xxs / R43Computed**. Worktree/branch: `worktrees/review-r43-computed-20261011` / `review-r43-computed-20261011`.

Scope: `lib/src/Carburetor/Derived/`, Derived-facing public models, связанные Computed tests, computed/derived/computed41/computed42 manifests и Computed-facing consumer callsites. Это **review-only**: production, tests, benchmarks, config и dependencies не изменены; writable только этот отчёт.

## Итог и пределы evidence

| ID | Приоритет | Новый механизм | Уровень доказательства |
|---|---|---|---|
| **R43-C01** | **P2, correctness / error recovery** | Unobserved `equals` бросает уже после публикации нового evaluation cache; следующий `get()` обходит comparator и выдаёт непринятый результат | Порядок присваиваний и exception boundary в source; bounded recipe ниже **ещё не исполнен** |
| **R43-C02** | **P2, scaling / лишние обходы** | После появления capture-owned builder один и тот же borrowed merged record повторно перечисляется для каждого downstream alias | Source-backed **[INFERENCE] Θ(K·M)** membership work при M+1 итоговых pairs; runtime counter и timing **не измерены** |
| **R43-C03** | **P2, retention / observer lifetime** | У observed scalar computed после equal source migration `announcement.versions` продолжает strongly держать уже retired store и его data | Конкретная strong-reference цепочка в source; collectibility и bytes **не измерены** |

Не заявляю подтверждённые runtime failures, speedup, allocated bytes, CPU instructions или React render savings. Ни Node recipes, ни build/tests/lint/formatters/perf/GC probes здесь не запускались. `git log -1` показал точный reviewed SHA и назначенную ветку; начальный worktree был чистым. `xd://lsp` ответил `No such tool: xd://lsp` (доступны ast_edit/debug), поэтому definitions/references установлены чтением source и поиском callsites, не LSP.

Прочитаны R42 overview **включая Resolution**, R42 Computed report, релевантные R41 findings/resolution и R32/R33/R34 Computed controls. Все три пункта отделены от исправленных R42-C01/C02/C03: здесь **нет** прежней потери merged groups, accumulated-prefix copying или undefined-sentinel bypass. Supplemental R42 timing flags не используются как evidence новых проблем.

Реальные consumers уже используют `{equals: shallowEqual}` и composition (`lib/src/ToDo/Derived/TodoViews.ts:27–30,42–48,68–69`); nullable/comparator-error routes присутствуют в current tests. Новые удобные public API без доказанной потребности не предлагаются: направления ниже сохраняют `computed(body, {equals})` и `read(computed)`.

## R43-C01 — comparator failure коммитит unobserved cache раньше acceptance

### Reachable операция и source

`computed(read => [read(store).n % 2], {equals})`: cold `get()` принимает `[1]`; запись `n:1→3` даёт новый, content-equal `[1]`. Первый refresh вызывает пользовательский comparator, который бросает. Приложение ловит ошибку и повторяет **обычный** `get()` без новой store write, либо исправляет причину comparator failure и читает снова.

- [`Computed.ts:273–298`](../lib/src/Carburetor/Derived/Computed.ts#L273): `attachDependencies` уже заменил versions/dependencies; затем `value = value` и `valid = true` стоят на **286–287**, а пользовательский `equals` вызывается через `announceIsUnchanged` лишь на **293**. Этот вызов находится **вне** catch на 277–284.
- [`announceIsUnchanged.ts:34–46`](../lib/src/Carburetor/Derived/Freshness/announceIsUnchanged.ts#L34): comparator вызывается на 44; его exception не становится успешным equality verdict.
- [`Computed.ts:147–152,214–232`](../lib/src/Carburetor/Derived/Computed.ts#L147): повторный `get()` доверяет уже valid cache и совпавшей native epoch. Он не возвращается к незавершённому equality decision.

**[INFERENCE]** Постоянно бросающий comparator вызовется один раз: первый `get()` бросит, второй вернёт новый array. Если между чтениями устранить failure и comparator должен вернуть true, второй read всё равно потеряет baseline identity, не запросив этот verdict. `snapshotRevision` при первой ошибке не вырос и на cached втором чтении тоже не вырастет. Это частичный commit неуспешной equality acceptance, а не undefined-specific R42-C03: оба значения — ordinary arrays.

`IComputedOptions.equals` допускает такую политику; current test [`R42UndefinedEquals.test.ts:211–225`](../__tests__/Engine/Derived/computed42/R42UndefinedEquals.test.ts#L211) уже требует propagation comparator error и unchanged revision, но заканчивается **до второго get**. Body-error controls, напротив, сохраняют повторную ошибку (`Computed/ErrorIsolation.test.ts:235–289`). Hook читает value и token вместе (`Interop/useComputedValue.ts:15–29`), поэтому из одного unchanged token здесь **нельзя** выводить stale hook DOM: hook дополнительно проверяет `Object.is(value)`. React последствия не проверены и не утверждаются.

### Безопасное направление и acceptance

Не принимать новый successful unobserved baseline до завершения equality decision. При throw сохранять предыдущий **успешно принятый** value/version baseline и не оставлять cache, который silently обойдёт failed decision. Простого `valid=false` недостаточно, если старый baseline/versions уже заменены: следующий recompute будет сравнивать с failed candidate. Нужна согласованная commit boundary для acceptance и его baseline; это не предложение общего retry API или подавления exceptions.

Invariants: cold compute не вызывает equals; persistent failure остаётся видимой следующему reader; recovery сравнивает с исходным successful baseline и сохраняет его identity при true; false принимает новый value с одним unobserved revision. Dependency/recorder migration и attachment rollback не должны ломаться. Observed eager reads по-прежнему не меняют announcement до settlement; live/exotic same-reference carve-outs сохраняются. Repeated body evaluation после failure допустима; exact retry body count не является public контрактом.

Предложить `computed43/equality-failure-acceptance`: persistent/recovered comparator failures, true/false и cold/empty controls, body-throw independent control, scalar/array/undefined и observed/unobserved lanes. Gate — acceptance identity, actual comparison arguments, exact Error identity и tokens/deliveries, не просто not-throw. Cheap successful cached pulls не должны получить дополнительные comparisons/allocations. Сохранить computed42/undefined-equals, computed/equals-list@20, ExoticResults, ErrorIsolation и deferred/publication freshness controls. Confidence высокая для source state order; disproof — если supplied bundle имеет иной порядок commit или error recovery намеренно документируется как отказ от comparator policy; такого договора в просмотренных models/README не найдено.

### Tiny recipe C01 — два get после ошибки

Parent сохраняет следующий **полный** snippet в ignored `worktrees/r43-computed-c01.mjs` назначенного worktree. `DIST_ROOT`/argv — **каталог конкретного format**, содержащий `Carburetor/index.mjs` либо `index.js`. Используется существующий `importPart` fixture; `createFixture` не вызывается, bundles не копируются/не меняются.

```js
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {importPart, bundleFormat} from '../__tests__/Engine/Resource/ResourceCache/Views/resource42/fixture.mjs';
const root = resolve(process.argv[2] ?? process.env.DIST_ROOT ?? 'dist/esm-prod');
const {Carburetor, computed} = await importPart(root, 'Carburetor');
const token = c => c[Symbol.for('react-carburetor/v1/computed-snapshot-version')]();
function lane(mode, recover = false) {
    const store = new Carburetor({n: 1});
    const failure = new Error('C01 comparator');
    let poison = false;
    const comparisons = [];
    const value = computed(read => [read(store).n % 2], {
        equals: (before, after) => {
            comparisons.push([before[0], after[0]]);
            if (poison) throw failure;
            return mode !== 'different' && before[0] === after[0];
        },
    });
    const baseline = value.get();
    assert.deepEqual(baseline, [1]);
    assert.equal(comparisons.length, 0); // cold independent control
    store.update(draft => { draft.n = 3; });
    poison = mode === 'throw';
    let first, firstError, second, secondError;
    try { first = value.get(); } catch (error) { firstError = error; }
    if (recover) poison = false;
    try { second = value.get(); } catch (error) { secondError = error; }
    return {mode, recover, firstThrow: firstError === failure,
        secondThrow: secondError === failure, comparisons,
        baselineRetained: second === baseline, firstRetained: first === baseline,
        secondValue: second, revision: token(value), deliveredVersion: value.getVersion()};
}
const same = lane('compare'), different = lane('different');
assert.equal(same.baselineRetained, true);
assert.equal(same.revision, 0);
assert.deepEqual(same.comparisons, [[1, 1]]);
assert.equal(different.baselineRetained, false);
assert.equal(different.revision, 1);
assert.deepEqual(different.secondValue, [1]);
// A body failure must not become a successful cached read either.
const source = new Carburetor({n: 1});
const bodyFailure = new Error('C01 body');
let poisonBody = false;
const body = computed(read => { const n = read(source).n; if (poisonBody) throw bodyFailure; return n; });
assert.equal(body.get(), 1);
poisonBody = true;
source.update(draft => { draft.n = 2; });
for (let i = 0; i < 2; i++) assert.throws(() => body.get(), error => error === bodyFailure);
poisonBody = false;
assert.equal(body.get(), 2);
assert.equal(token(body), 1);
const persistent = lane('throw'), recovered = lane('throw', true);
assert.equal(persistent.firstThrow, true);
assert.equal(recovered.firstThrow, true);
console.log(JSON.stringify({format: bundleFormat(root), same, different, persistent, recovered}));
// Desired consumer invariant; current source predicts failure, not an observed stdout.
assert.ok(persistent.secondThrow && recovered.baselineRetained,
    'failed equality must not silently accept the candidate on the next get');
```

## R43-C02 — повторный borrowed-group scan после первого merge

### Reachable graph и отличие от R42

Observed `group = sum(M per-field computeds)` над одним store; K computeds строят разные cheap значения `read(group) + i`. Верхний total читает **сначала** `read(store).extra`, затем эти K branches. Запись только `extra` заставляет переоценить total, но не group/branches. Group уже observed отдельным consumer, поэтому branches могут заимствовать **один и тот же** immutable leaf record/parts array.

[`captureLeafVersions.ts:24–26`](../lib/src/Carburetor/Derived/Freshness/captureLeafVersions.ts#L24) имеет identity fast path `previous === recorded`. Первый extra+group merge на 46–59 заменяет `versions[id]` на **builder.output**, отличный от borrowed group. Для всех последующих aliases этот fast path больше не проходит, и [`:61–64`](../lib/src/Carburetor/Derived/Freshness/captureLeafVersions.ts#L61) снова обходит те же M `recorded.parts`; [`:33–44`](../lib/src/Carburetor/Derived/Freshness/captureLeafVersions.ts#L33) отбрасывает duplicates только **после** membership.get.

**[INFERENCE]** У top capture K·M common-pair probes ради M+1 уникальных retained pairs. При K=M — квадратичный член, хотя body имеет K cheap reads. Это **не** прежнее copying accumulated output prefix: current builder appends каждый уникальный pair один раз, R42-C02 исправлен. Здесь повторно сканируется **borrowed input**, потому что output identity уже другая. Обратный порядок — сначала K branches, потом extra — позволяет `previous===recorded` до merge и требует только M common probes. Отдельный extra store вообще не создаёт collision builder для group leaf. Эти controls способны опровергнуть предложенный механизм.

Current coverage: `R42LeafCapture.test.ts:115–139` проверяет dedup/output correctness, но repeated genuine record стоит **до** отличного group. `:273–324` обходит distinct borrowed groups один раз, а `:326–440` / `computed42/fan-in-part-work` — distinct bare inputs. 26-node diamond имеет всего два constituent pairs (`:160–239`), не independently scaled M и K. Ни один из этих контрактов не доказывает отсутствие repeated identical M-part scan после collision.

### Безопасное направление и protection

Capture-local учёт уже полностью обработанного **точного borrowed record identity** у colliding leaf; при повторе не перечислять его parts снова. Не нужен cross-evaluation cache: он удерживал бы obsolete sources. Не заменять per-pair reads-identity+version dedup и не объявлять разные records одинаковыми по UID/path text. Сохранить last-record summary version/data и ordering semantics даже при пропуске повторного traversal; не мутировать borrowed/upstream/old arrays. Для no-collision и tiny K=1 paths не добавлять безусловный Set/Map. Возможный retained bookkeeping O(числа distinct colliding records) — tradeoff, а не бесплатная оптимизация.

Предложить `computed43/repeated-borrowed-group`: independent K=1/4/16/64 и M=4/16/64, bare-first/merged-first/distinct-extra layouts; warmed observed group и retained branches. Deterministic gate — common membership probes O(M), полный pair coverage M+1, current checksum, publication/version и upstream/old snapshot integrity. Empty window=0, positive common-read-key Map control=M; unrelated write quiet и actual common-leaf write корректно публикуется. Отдельно uninstrumented whole `extra update+get` A/B, без prototype overhead в timing; static probe counts — **не bytes/latency**. Защитить constructor work на K=1/no-collision и old computed42 shared/distinct part-work/timing, R32 Set work, R34 filed identity, diamond-ladder и computed41 dependencies gates. Confidence высокая для traversal; whole-operation значимость и выигрыш пока неизвестны. Disproof — branches не делят record identity либо counter считает чужую Map работу; recipe проверяет identity и фильтрует exact common reads keys, а native drift lookup использует WeakMap (`Store/Carburetor.ts:163–171`).

### Tiny recipe C02 — actual update, identity/order controls

Сохранить как ignored `worktrees/r43-computed-c02.mjs`. Instrumentation ограничена synchronous окном; prototype восстановлен в `finally`. Считаются Map.get с **реальными common filed Set identities**, не время и не allocated bytes.

```js
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {importPart, bundleFormat} from '../__tests__/Engine/Resource/ResourceCache/Views/resource42/fixture.mjs';
const root = resolve(process.argv[2] ?? process.env.DIST_ROOT ?? 'dist/esm-prod');
const require = createRequire(import.meta.url);
const load = name => bundleFormat(root) === 'cjs'
    ? Promise.resolve(require(resolve(root, name + '.js')))
    : import(pathToFileURL(resolve(root, name + '.mjs')).href);
const {Carburetor, computed} = await importPart(root, 'Carburetor');
const {computedDependencies} = await load('Carburetor/Derived/computedDependencies');
const snapshot = c => computedDependencies.versions.get(c)();
function run(K, M, layout) {
    const data = {extra: 0, noise: 0};
    for (let i = 0; i < M; i++) data['p' + i] = i + 1;
    const store = new Carburetor(data);
    const extra = layout === 'distinct' ? new Carburetor({extra: 0}) : store;
    const leaves = Array.from({length: M}, (_, i) => computed(read => read(store)['p' + i]));
    let groupRuns = 0, topRuns = 0;
    const group = computed(read => { groupRuns++; return leaves.reduce((sum, c) => sum + read(c), 0); });
    const groupId = group.subscribe(() => {}); // establish stable shared metadata before aliases
    const aliasRuns = Array(K).fill(0);
    const aliases = Array.from({length: K}, (_, i) => computed(read => { aliasRuns[i]++; return read(group) + i; }));
    const top = computed(read => {
        topRuns++;
        let e = layout === 'merged-first' ? 0 : read(extra).extra;
        const sum = aliases.reduce((total, c) => total + read(c), 0);
        if (layout === 'merged-first') e = read(extra).extra;
        return sum + e;
    });
    const events = [];
    const topId = top.subscribe(() => events.push(top.get()));
    try {
        const initial = K * M * (M + 1) / 2 + K * (K - 1) / 2;
        assert.equal(top.get(), initial);
        const borrowed = Object.values(snapshot(group))[0];
        const partsBefore = borrowed.parts.slice();
        assert.equal(partsBefore.length, M);
        assert.ok(aliases.every(c => Object.values(snapshot(c))[0] === borrowed));
        const commonReads = new Set(partsBefore.map(part => part.reads));
        const nativeGet = Map.prototype.get;
        function count(body) {
            let gets = 0;
            Map.prototype.get = function(key) {
                if (commonReads.has(key)) gets++;
                return nativeGet.call(this, key);
            };
            try { const value = body(); return {gets, value}; }
            finally { Map.prototype.get = nativeGet; }
        }
        assert.equal(count(() => 0).gets, 0);
        const known = new Map(partsBefore.map(part => [part.reads, part.version]));
        assert.equal(count(() => { for (const part of partsBefore) known.get(part.reads); }).gets, M);
        const work = count(() => { extra.update(draft => { draft.extra++; }); return top.get(); });
        assert.equal(work.value, initial + 1);
        assert.deepEqual(events, [initial + 1]);
        assert.equal(groupRuns, 1);
        assert.deepEqual(aliasRuns, Array(K).fill(1));
        assert.equal(topRuns, 2);
        const current = Object.values(snapshot(top));
        assert.equal(current.reduce((n, record) => n + (record.parts?.length ?? 1), 0), M + 1);
        assert.deepEqual(borrowed.parts, partsBefore);
        store.update(draft => { draft.noise++; });
        assert.equal(top.get(), initial + 1);
        assert.equal(topRuns, 2);
        store.update(draft => { draft.p0++; });
        assert.equal(top.get(), initial + 1 + K);
        assert.deepEqual(events, [initial + 1, initial + 1 + K]);
        assert.equal(top.getVersion(), 2);
        assert.deepEqual(borrowed.parts, partsBefore);
        return {K, M, layout, commonProbes: work.gets, pairs: M + 1};
    } finally { top.unsubscribe(topId); group.unsubscribe(groupId); }
}
const rows = [];
for (const K of [1, 4, 8]) for (const M of [4, 8]) {
    for (const layout of ['bare-first', 'merged-first', 'distinct']) rows.push(run(K, M, layout));
}
console.log(JSON.stringify({format: bundleFormat(root), rows}));
assert.ok(rows.filter(row => row.layout === 'merged-first').every(row => row.commonProbes === row.M));
assert.ok(rows.filter(row => row.layout === 'distinct').every(row => row.commonProbes === 0));
// Desired bound; current source predicts K*M for bare-first, not an observed counter result.
assert.ok(rows.filter(row => row.layout === 'bare-first').every(row => row.commonProbes <= row.M),
    'one identical borrowed group must not be rescanned per alias after a collision');
```

## R43-C03 — active equal migration удерживает obsolete announcement sources

### Reachable операция и strong-reference chain

Долго observed scalar derived читает tick/source selector и выбранный store.n. Owner переключает выбранный source с A на B, у обоих `n=1`, и публикует reactive tick. Body успешно переоценивается, releases A, принимает B; результат остаётся 1, поэтому delivery не нужна. Caller больше не хранит A и продолжает пользоваться этим computed, не снимая последнюю подписку.

- [`Computed.ts:395–408`](../lib/src/Carburetor/Derived/Computed.ts#L395) снимает retired edge и публикует current dependencies; [`computedDependencies.ts:108–127`](../lib/src/Carburetor/Derived/computedDependencies.ts#L108) очищает retired recorder slot.
- Но [`Computed.ts:546–555`](../lib/src/Carburetor/Derived/Computed.ts#L546) при `unchanged` лишь возвращает baseline value; `announced.versions` не принимает успешно settled dependency checkpoint. Announcement меняется только при отличном result на 558 либо новом first observer на 177–179.
- Поэтому остаётся `live computed → C.announced → versions[old UID] → ILeafVersion.source / data → A / A.getData()`. Source/data refs видны в [`Freshness/Models.ts:3–11`](../lib/src/Carburetor/Derived/Freshness/Models.ts#L3), capture на `captureLeafVersions.ts:80–83`.

Это **не** R41-02 last-release defect: текущий last release уже очищает announcement (`Computed.ts:449–458`), а здесь subscriber всё время жив. Это также не intentional retained evaluation cache и не baseline value ownership: current evaluation scalar, его versions уже B, старый scalar `1` не держит A. Удерживается initial successful announcement source set, не все когда-либо использованные sources; claim «unbounded leak per switch» был бы неверен. Retained graph size зависит от payload/ownership каждого obsolete leaf; bytes/GC эффект не измерены.

R41 lifetime benchmark переключает source одновременно с **отличным scalar** 10→20→30→40 (`computed41/lifetime.mjs:52–101`), что заменяет announcement. R42 equal migration test (`R42UndefinedEquals.test.ts:123–159`) держит left/right lexical refs и проверяет subscriptions/value, не collection. Отсюда gap — equal scalar migration при alive observation и исчезнувшем caller reference.

### Безопасное направление, invariants и risks

После **успешного settlement**, где результат принят unchanged, продвинуть dependency checkpoint observer baseline на текущий successful snapshot, сохранив сам accepted value, public version и отсутствие delivery. Не делать это в eager recompute до wave drain: он ещё не погасил owed publication. Не мутировать ранее captured snapshot objects. Current tests pin-ят identity `C.announced` после equal settlement (`R42UndefinedEquals.test.ts:113,201`); это internal assertion, требующий осознанного обновления, а не повод нарушить public baseline/value identity. Generation guard и failed comparator/body/attachment не должны подтверждать checkpoint.

Для live/exotic baseline, который **сам** владеет старым payload, collection не обещается: это legitimate caller/value ownership. External silent versions, branch/reused-ID migration, reentrant teardown, transaction/throttle eager pulls и same-reference exotic publication — обязательные controls. Успешный equal settlement должен оставлять notifications/version unchanged и новые edges активными; retired source write не должен запускать body.

Предложить `computed43/observed-equal-source-lifetime`: scalar same/changed, unobserved и strong-held source controls; sync returned setup, alive owners, closed retired writes и active replacement write. Separate GC lane со WeakRef и bounded job boundaries, **не flaky ordinary unit test**. Source-backed metadata membership — deterministic test; collectibility — parent-run diagnostic/permanent liveness gate с controls. Дополнительный projection-equals lane сохраняет baseline value identity, но не обещает освобождение payload, принадлежащего этому value. Cheap same-source equal tick и empty derived защищают отсутствие лишних subscription/collection constructors; full-operation timing отдельно. Старые observer-lifetime, queued/reentrant Lifecycle, retained native identity и deferred publication gates не ослаблять. Confidence высокая для strong-reference chain, средняя для proposed checkpoint cutover до adversarial runtime проверки; GC/no-byte claims пока отсутствуют.

### Tiny recipe C03 — alive observation, equal/changed/held controls

Сохранить как ignored `worktrees/r43-computed-c03.mjs`, запускать с `--expose-gc`. Всего четыре небольших store graphs, по 32 payload entries; нет artificial memory pressure. Body и observer closure factories вынесены из setup scope, setup возвращается **до GC**; metadata не сохраняется strong в probe result.

```js
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {importPart, bundleFormat} from '../__tests__/Engine/Resource/ResourceCache/Views/resource42/fixture.mjs';
const root = resolve(process.argv[2] ?? process.env.DIST_ROOT ?? 'dist/esm-prod');
const require = createRequire(import.meta.url);
const load = name => bundleFormat(root) === 'cjs'
    ? Promise.resolve(require(resolve(root, name + '.js')))
    : import(pathToFileURL(resolve(root, name + '.mjs')).href);
const {Carburetor, computed} = await importPart(root, 'Carburetor');
const {C} = await load('Carburetor/Derived/Models');
const {computedDependencies} = await load('Carburetor/Derived/computedDependencies');
assert.equal(typeof globalThis.gc, 'function');
function makeOwner(gate, choice) {
    let runs = 0;
    const owner = computed(read => { runs++; void read(gate).tick; return read(choice.current).n; });
    return {owner, runs: () => runs};
}
function observe(owner, events) { return owner.subscribe(() => events.push(owner.get())); }
function contains(versions, uid) { return Object.values(versions).some(record => record.source.getUID() === uid); }
function setup(kind) {
    const gate = new Carburetor({tick: 0});
    const choice = {current: new Carburetor({n: 1, payload: Array.from({length: 32}, (_, i) => ({i}))})};
    const {owner, runs} = makeOwner(gate, choice);
    const events = [];
    const id = kind === 'unobserved' ? undefined : observe(owner, events);
    assert.equal(owner.get(), 1);
    const previous = choice.current, uid = previous.getUID(), ref = new WeakRef(previous);
    const held = kind === 'held' ? previous : undefined;
    const expected = kind === 'changed' ? 2 : 1;
    choice.current = new Carburetor({n: expected});
    gate.update(draft => { draft.tick++; });
    assert.equal(owner.get(), expected);
    assert.deepEqual(events, kind === 'changed' ? [2] : []);
    const before = runs();
    previous.update(draft => { draft.n = 9; });
    assert.equal(owner.get(), expected);
    assert.equal(runs(), before); // retired precision, not just equal result
    const currentHasOld = contains(computedDependencies.versions.get(owner)(), uid);
    const announcementHasOld = contains(owner[C.announced]?.versions ?? {}, uid);
    assert.equal(currentHasOld, false);
    return {kind, owner, gate, choice, events, id, ref, held, expected, currentHasOld, announcementHasOld};
}
const lanes = ['equal', 'changed', 'unobserved', 'held'].map(setup);
const empty = (() => new WeakRef({empty: true}))();
const boundary = () => new Promise(resolve => setImmediate(resolve));
async function collect() {
    for (let i = 0; i < 12; i++) { await boundary(); globalThis.gc(); }
    await boundary();
}
await collect();
const before = lanes.map(lane => {
    assert.equal(lane.owner.get(), lane.expected);
    assert.equal(lane.gate.getData().tick, 1);
    return {kind: lane.kind, alive: lane.ref.deref() !== undefined,
        currentHasOld: lane.currentHasOld, announcementHasOld: lane.announcementHasOld};
});
assert.equal(empty.deref(), undefined);
assert.equal(before.find(row => row.kind === 'changed').alive, false);
assert.equal(before.find(row => row.kind === 'unobserved').alive, false);
assert.equal(before.find(row => row.kind === 'held').alive, true);
for (const lane of lanes) if (lane.id !== undefined) lane.owner.unsubscribe(lane.id);
await collect();
const afterRelease = lanes.map(lane => ({kind: lane.kind, alive: lane.ref.deref() !== undefined}));
assert.equal(afterRelease.find(row => row.kind === 'equal').alive, false);
assert.equal(afterRelease.find(row => row.kind === 'held').alive, true);
const equal = lanes[0];
const rejoined = observe(equal.owner, equal.events);
equal.choice.current.update(draft => { draft.n = 3; });
assert.equal(equal.owner.get(), 3);
assert.deepEqual(equal.events, [3]); // real replacement delivery after rejoin
equal.owner.unsubscribe(rejoined);
for (const lane of lanes) assert.equal(lane.owner.get(), lane.kind === 'equal' ? 3 : lane.expected);
console.log(JSON.stringify({format: bundleFormat(root), before, afterRelease, replacement: equal.events}));
// Desired liveness boundary; no collection result has been observed by this agent.
assert.equal(before.find(row => row.kind === 'equal').alive, false,
    'settled equal scalar migration must not retain the retired source through announcement metadata');
```

## Что проверено чтением и не переобъявлено finding

- R42 lossless capture, capture-owned linear output builder, reads-identity **и captured version** dedup, undefined-aware baseline — база review, не новые дефекты. C02 не предлагает отказаться от этих механизмов.
- R41 symbol storage/fresh flags/last-release announcement cleanup/weak source-identity recorder slots и lexical recorder factory присутствуют. Не предлагаю вернуть recorder closure внутрь recompute ради временной allocation.
- PersistentViews.view действительно получает новый recorder argument на cache hit (`Computed.ts:264,305–310`; `PersistentViewCache.ts:37–40`), но relevance/bytes не установлены; это уже rejected R42 candidate, здесь не padding finding.
- All-native stable `get()` имеет epoch shortcut; external silent public versions требуют checks. Flattened snapshot ownership и retained evaluation до следующего successful read — intentional cost, не blanket leak claim.
- Delivery snapshot/generation guards, release/rejoin и recorder retirement просмотрены с existing Lifecycle/Dependencies/ErrorIsolation coverage. Новый публичный dispose/selector overload без evidenced consumer friction не обоснован.
- `renderOwner`/escape reporting — development-only diagnostic (`renderOwner.ts:8–11`, `reportComputedEscape.ts:27–44`), не production invalidation mechanism. Не подменяю precision корректировкой warning.
- UI execution, mixed-format graph matrix, browser, heap snapshots, allocated-byte profiling, A/B prototypes и old/permanent gates здесь **не исполнялись**. Предлагаемые bench names ещё не созданы.

## Порядок parent verification и точные команды

Parent сообщил, что frozen bundles скопированы из уже built/smoked current dist в **`D:/dev/ReactCarburetor/worktrees/bench-dist/90a1c6041c2d/{esm,esm-prod,cjs,cjs-prod}`**, без rebuild; это provenance от parent, не собственный runtime evidence агента. CJS entry — **index.js**, не index.cjs; loader выбирает реальные файлы через existing `bundleFormat`/`importPart` (`resource42/fixture.mjs:13–24`).

1. Сохранить три полных snippets выше в assigned worktree, **вне tracked scope отчёта**, и запускать serially C01 → C02 → C03. C01/С03 проверяют acceptance/lifetime, C02 — только mechanism work; каждый сначала проверяет independent controls и печатает diagnostics, затем проверяет **desired invariant**. **[INFERENCE]** На текущем source финальный assert каждого recipe должен обнаружить описанный gap; exit !=0 здесь ожидаемый reproduction outcome, не уже полученный результат и не suite pass. Если раньше падает control/import, это invalid probe, не подтверждение finding.
2. Минимальная production/development пара из cwd `D:/dev/ReactCarburetor/worktrees/review-r43-computed-20261011`:

```text
node worktrees/r43-computed-c01.mjs D:/dev/ReactCarburetor/worktrees/bench-dist/90a1c6041c2d/esm-prod
node worktrees/r43-computed-c01.mjs D:/dev/ReactCarburetor/worktrees/bench-dist/90a1c6041c2d/esm
node worktrees/r43-computed-c02.mjs D:/dev/ReactCarburetor/worktrees/bench-dist/90a1c6041c2d/esm-prod
node worktrees/r43-computed-c02.mjs D:/dev/ReactCarburetor/worktrees/bench-dist/90a1c6041c2d/esm
node --expose-gc worktrees/r43-computed-c03.mjs D:/dev/ReactCarburetor/worktrees/bench-dist/90a1c6041c2d/esm-prod
node --expose-gc worktrees/r43-computed-c03.mjs D:/dev/ReactCarburetor/worktrees/bench-dist/90a1c6041c2d/esm
```

3. При подтверждении повторить с `/cjs` и `/cjs-prod` по тем же argv/DIST_ROOT conventions, затем добавить adversarial comparator/transaction/retained-snapshot controls до реализации. GC control failures диагностировать отдельно; не выводить collection из одного metadata boolean.
4. После будущих fixes — permanent new+old gates одним orchestrator-run, serial whole-operation baseline/fix A/B без counter wrappers и без ослабления old gates. Этот review не содержит production prototype или promises выигрыша.

## Raw-source citations / coverage

- Current mechanics: [`Computed.ts:236–298`](../lib/src/Carburetor/Derived/Computed.ts#L236), [`:332–443`](../lib/src/Carburetor/Derived/Computed.ts#L332), [`:445–560`](../lib/src/Carburetor/Derived/Computed.ts#L445); [`captureLeafVersions.ts:24–96`](../lib/src/Carburetor/Derived/Freshness/captureLeafVersions.ts#L24); [`announceIsUnchanged.ts:27–46`](../lib/src/Carburetor/Derived/Freshness/announceIsUnchanged.ts#L27); [`leafVersionsDrifted.ts:12–58`](../lib/src/Carburetor/Derived/Freshness/leafVersionsDrifted.ts#L12); [`driftedSince.ts:9–24`](../lib/src/Carburetor/Derived/Freshness/driftedSince.ts#L9).
- Contracts/consumers: [`Models/Derived.ts:9–33`](../lib/src/Carburetor/Models/Derived.ts#L9), [`README.md:373–445`](../README.md#L373), [`TodoViews.ts:27–69`](../lib/src/ToDo/Derived/TodoViews.ts#L27), [`Interop/useComputedValue.ts:15–50`](../lib/src/Interop/useComputedValue.ts#L15), [`Component/AntiHookComponent/Reads.tsx:352–363`](../lib/src/Carburetor/Component/AntiHookComponent/Reads.tsx#L352).
- Relevant existing tests: [`R42UndefinedEquals.test.ts:94–225`](../__tests__/Engine/Derived/computed42/R42UndefinedEquals.test.ts#L94), [`R42LeafCapture.test.ts:115–158,160–239,273–440`](../__tests__/Engine/Derived/computed42/R42LeafCapture.test.ts#L115), [`computed41/Lifecycle.test.ts:8–108`](../__tests__/Engine/Derived/computed41/Lifecycle.test.ts#L8), [`Computed/DependencyMaintenance.test.ts:37–138,235–269`](../__tests__/Engine/Derived/Computed/DependencyMaintenance.test.ts#L37), [`Computed/Freshness/RetainedIdentity.test.tsx:49–114`](../__tests__/Engine/Derived/Computed/Freshness/RetainedIdentity.test.tsx#L49), [`DeferredFreshness.test.tsx:187–239`](../__tests__/Engine/Derived/Computed/Freshness/DeferredFreshness.test.tsx#L187).
- Existing benchmark protection: [`computed42.mjs:3–44`](../perf/gates/computed42.mjs#L3), [`computed41.mjs:8–30`](../perf/gates/computed41.mjs#L8), [`computed.mjs:16–128`](../perf/gates/computed.mjs#L16), [`derived.mjs:5–57`](../perf/gates/derived.mjs#L5); [`computed41/lifetime.mjs:52–137`](../perf/scenarios/computed41/lifetime.mjs#L52), [`computed42/part-work.mjs:9–109`](../perf/scenarios/computed42/part-work.mjs#L9).
- Novelty boundary: [R42 overview / Resolution](api-engine-review-round-42-2026-10-10.md#resolution--2026-10-11), [R42 Computed findings/rejected candidates](api-engine-review-round-42-computed-2026-10-10.md), [R41 resolution](api-engine-review-round-41-2026-10-09.md#resolution--2026-10-10).

## Parent verification — 2026-10-11

Parent лично исполнил все три полных recipes на immutable reviewed base в **esm-prod,
esm, cjs-prod и cjs**: 12 отдельных serial Node v24.12.0 processes. Все independent controls
прошли; expected final desired-invariant assertion каждого recipe подтвердил именно gap,
а не import/control failure. Исходный автор runtime не исполнял; этот раздел добавлен parent
при squash. Source/proposed fixes по-прежнему не изменены.

- **C01:** persistent и recovered first read бросают exact comparator Error; second read уже
  не бросает и не сохраняет accepted array identity. Comparator calls остаются 1, revision 0.
  True/false baseline controls и repeated body-error propagation проходят.
- **C02:** K=8/M=8: bare-first 64 common probes, merged-first 8, distinct-extra 0,
  при 9 retained pairs. K=1/4/8, M=4/8, positive/empty, immutable upstream parts,
  unrelated quiet write и genuine common-leaf deliveries проходят.
- **C03:** equal observed lane держит retired source: current snapshot не содержит его,
  announcement содержит. Changed/unobserved lanes collectible, caller-held control live;
  last release освобождает equal target, rejoin доставляет replacement 3.

Counter counts и collectibility — actual observations, не total allocated-byte/latency savings.
Raw receipts: `.rush/stdin/r43-core-probes.json`; scope/provenance и порядок реализации —
[общий R43 отчёт](api-engine-review-round-43-2026-10-11.md).

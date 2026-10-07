/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {emit, load, setupReact} from '../../harness/lib.mjs';
const {Carburetor} = await load();
class TestStore extends Carburetor { change(fn) { this.update(fn); } }
const count = run => {
    const counts = {weakmaps: 0, weaksets: 0}; const WM = WeakMap; const WS = WeakSet;
    globalThis.WeakMap = class extends WM { constructor(...args) { counts.weakmaps++; super(...args); } };
    globalThis.WeakSet = class extends WS { constructor(...args) { counts.weaksets++; super(...args); } };
    try { run(); } finally { globalThis.WeakMap = WM; globalThis.WeakSet = WS; }
    return counts;
};
const sizes = [1000, 4000, 16000];
const cycles = sizes.map(size => {
    const rows = Array.from({length: size}, (_, id) => ({id, n: 1, link: null})); rows[0].link = new Map([['root', rows]]);
    class Counting extends TestStore { recorded = 0; read(record) { return super.read(path => { this.recorded++; record(path); }); } }
    const store = new Counting({rows, tick: 0}); let callbacks = 0; let latest; let previous;
    const stop = store.watch(d => { void d.tick; return d.rows; }, (next, before) => { callbacks++; latest = next; previous = before; });
    store.change(d => { d.tick = 0; }); store.recorded = 0; let callbacksBeforeMeasure = callbacks;
    store.change(d => { d.tick = 1; }); const reads = store.recorded;
    const quiet = callbacks === callbacksBeforeMeasure;
    store.change(d => { d.tick = 2; }); const quietAfterTwo = callbacks === callbacksBeforeMeasure;
    const beforeActualChange = callbacks;
    store.change(d => { d.rows[0].n = 2; }); const first = latest; const firstPrevious = previous;
    const changed = callbacks === beforeActualChange + 1 && Array.isArray(latest) && latest[0].n === 2 && latest[0].link.get('root') === latest;
    const held = firstPrevious?.[0]?.n === 1;
    store.change(d => { d.rows[0].n = 3; });
    const heldSuccessive = callbacks === beforeActualChange + 2 && first?.[0]?.n === 2 && previous === first && latest?.[0]?.n === 3;
    stop(); return {reads, callbacks, changed: changed && heldSuccessive, held, quiet: quiet && quietAfterTwo, quietAfterTwo};
});
const construct = kind => {
    const store = new TestStore({tick: 0}); let callbacks = 0;
    const stop = store.watch(d => kind === 'scalar' ? d.tick % 2 : kind === 'tuple' ? [d.tick % 2, true] : {n: d.tick % 2, flag: true}, () => { callbacks++; });
    store.change(d => { d.tick = 0; }); const measured = count(() => store.change(d => { d.tick = 2; })); stop(); return {...measured, callbacks};
};
const flat = Object.fromEntries(['scalar', 'tuple', 'object'].map(kind => [kind, construct(kind)]));
const sparseFlat = () => {
    const items = [1, 3];
    Reflect.deleteProperty(items, '1');
    Object.defineProperty(items, '2', {value: 3, writable: true, enumerable: false, configurable: true});
    const store = new TestStore({tick: 0, items}); let callbacks = 0; let latest; let ownUndefined = false;
    const stop = store.watch(d => { void d.tick; return d.items; }, next => { callbacks++; latest = next; });
    store.change(d => { d.tick = 0; });
    const measured = count(() => {
        store.change(d => { d.tick = 2; });
        store.change(d => { d.items[0] = 2; });
        store.change(d => { d.items[1] = undefined; });
        ownUndefined = Object.hasOwn(latest, 1) && latest[1] === undefined;
        store.change(d => { delete d.items[1]; });
    });
    const descriptor = Object.getOwnPropertyDescriptor(latest, '2');
    const hole = !Object.hasOwn(latest, 1);
    const preserved = Object.hasOwn(latest, 2) && descriptor?.enumerable === false && latest[2] === 3;
    const removed = !Object.hasOwn(latest, 1);
    const index0 = latest?.[0];
    stop(); return {...measured, callbacks, sparseCallbacks: callbacks, sparseIndex0: index0, hole, preserved, ownUndefined, removed, sparseHoles: hole && ownUndefined && removed};
};
const sparse = sparseFlat();
const rawMember = () => {
    const date = new Date(1); const otherMap = new Map([['date', date]]);
    const node = {n: 1}; node.link = new Map([['self', node], ['peer', date]]);
    const store = new TestStore({node, otherMap, tick: 0}); const seen = []; let previous;
    const stop = store.watch(d => (void d.tick, d.node), (next, before) => { seen.push(next); previous = before; });
    store.change(d => { const member = d.otherMap.get('date'); member.setTime(2); d.tick = 2; });
    const delivered = seen.length === 1 && seen[0].link.get('peer').getTime() === 2
        && previous?.link.get('peer').getTime() === 1 && seen[0].link.get('self') === seen[0];
    stop(); return {delivered};
};
const rawMemberProbe = rawMember();
const watcherCase = (kind, watchers) => {
    const store = new TestStore({tick: 0}); let calls = 0; let callbacks = 0;
    const stops = Array.from({length: watchers}, () => store.watch(d => {
        calls++;
        return kind === 'scalar' ? d.tick % 2 : kind === 'tuple' ? [d.tick % 2, true] : {n: d.tick % 2, flag: true};
    }, () => { callbacks++; }));
    calls = 0; store.change(d => { d.tick = 0; }); calls = 0;
    const measured = count(() => store.change(d => { d.tick = 2; }));
    for (const stop of stops) stop();
    return {...measured, calls, callbacks};
};
const many = Object.fromEntries(['scalar', 'tuple', 'object'].flatMap(kind => [64, 128].map(n => [`${kind}${n}`, watcherCase(kind, n)])));
const topology = kind => {
    const store = new TestStore({tick: 0, node: {n: 1, child: {n: 1}, peer: null}}); let latest;
    if (kind === 'cycle') store.change(d => { d.node.peer = new Map([['self', d.node]]); });
    const stop = store.watch(d => kind === 'cycle' ? d.node : ({node: d.node, n: d.node.n}), value => { latest = value; });
    const measured = count(() => store.change(d => { d.node.n = 2; }));
    const valid = kind === 'cycle' ? latest?.n === 2 && latest.peer.get('self') === latest : latest?.n === 2 && latest.node?.n === 2;
    stop(); return {...measured, valid};
};
const positive = {nested: topology('nested'), cycle: topology('cycle')};
const positiveValid = positive.nested.valid && positive.cycle.valid;
const gcCase = async mode => {
    const store = new TestStore({active: true, rows: Array.from({length: 10000}, (_, id) => ({id}))}); let ref;
    let stop = store.watch(d => d.active ? d.rows : mode === 'scalar' ? 0 : ({n: 0}), (next, previous) => { if (Array.isArray(previous)) ref = new WeakRef(previous); });
    store.change(d => { d.active = false; });
    const retained = await (async () => {
        for (let i = 0; i < 8; i++) { await new Promise(resolve => setImmediate(resolve)); globalThis.gc(); }
        return ref?.deref() !== undefined;
    })();
    const rawAlive = store.getData().rows.length === 10000;
    stop(); stop = undefined;
    for (let i = 0; i < 8; i++) { await new Promise(resolve => setImmediate(resolve)); globalThis.gc(); }
    return {retained, afterDispose: ref?.deref() !== undefined, rawAlive};
};
const retention = {scalar: await gcCase('scalar'), object: await gcCase('object')};
// Production class probe: actual AntiHookComponent renders invoke the public getter returned by
// connectSelection; parent prop updates exercise real React ownership/rendering, not store.watch.
const {AntiHookComponent} = await load();
const {React, flushSync, root, container} = await setupReact();
const classStore = new TestStore({tick: 0}); let classRenders = 0; let classCalls = 0;
class SelectionOwner extends AntiHookComponent {
    selected = this.connectSelection(classStore, d => { classCalls++; return this.props.kind === 'object' ? {nested: {value: d.tick}, cycle: d.node} : d.tick; });
    render() {
        classRenders++;
        const value = this.selected();
        return React.createElement('output', null, this.props.kind === 'object' ? value.nested.value : value);
    }
}
classStore.change(d => { d.tick = 0; d.node = {}; d.node.self = d.node; });
const classProbe = kind => {
    classRenders = 0; classCalls = 0;
    flushSync(() => root.render(React.createElement(SelectionOwner, {kind, revision: 0})));
    // Warm mount is outside measurement; parent prop renders must not change DOM attributes.
    classRenders = 0; classCalls = 0;
    const measured = count(() => {
        for (let revision = 1; revision <= 3; revision++)
            flushSync(() => root.render(React.createElement(SelectionOwner, {kind, revision})));
    });
    const result = {renders: classRenders, calls: classCalls, value: container.textContent, ...measured};
    flushSync(() => root.render(null));
    return result;
};
const classPrimitive = classProbe('scalar');
const classObject = classProbe('object');
root.unmount();
emit({
    readCounts: cycles.map(x => x.reads).join(','), cycleCallbacks: cycles.map(x => x.callbacks - 2).join(','), cycleControls: cycles.every(x => x.changed && x.held), cycleQuietAfterTwo: cycles.every(x => x.quiet && x.quietAfterTwo),
    flatWeakmaps: [flat.scalar.weakmaps, flat.tuple.weakmaps, flat.object.weakmaps].join(','), flatWeaksets: [flat.scalar.weaksets, flat.tuple.weaksets, flat.object.weaksets].join(','), flatCallbacks: [flat.scalar.callbacks, flat.tuple.callbacks, flat.object.callbacks].join(','),
    sparseWeakmaps: sparse.weakmaps, sparseWeaksets: sparse.weaksets,
    sparseCallbacks: sparse.sparseCallbacks, sparseIndex0: sparse.sparseIndex0,
    sparsePositive: sparse.hole && sparse.preserved && sparse.ownUndefined && sparse.removed && sparse.callbacks > 0,
    sparseHoles: sparse.sparseHoles, rawMemberPositive: rawMemberProbe.delivered,
    nestedWeakmaps: positive.nested.weakmaps, cycleWeakmaps: positive.cycle.weakmaps, nestedWeaksets: positive.nested.weaksets, cycleWeaksets: positive.cycle.weaksets, positiveValid,
    scalarRetained: retention.scalar.retained, objectControlRetained: retention.object.retained, scalarAfterDispose: retention.scalar.afterDispose, objectAfterDispose: retention.object.afterDispose, rawRowsAlive: retention.scalar.rawAlive && retention.object.rawAlive,
    manySelectorCalls: ['scalar64', 'tuple64', 'object64', 'scalar128', 'tuple128', 'object128'].map(k => many[k].calls).join(','),
    manyCallbacks: ['scalar64', 'tuple64', 'object64', 'scalar128', 'tuple128', 'object128'].map(k => many[k].callbacks).join(','),
    manyWeakmaps: ['scalar64', 'tuple64', 'object64', 'scalar128', 'tuple128', 'object128'].map(k => many[k].weakmaps).join(','),
    manyWeaksets: ['scalar64', 'tuple64', 'object64', 'scalar128', 'tuple128', 'object128'].map(k => many[k].weaksets).join(','),
    classPrimitiveRenders: classPrimitive.renders, classPrimitiveCalls: classPrimitive.calls, classPrimitiveValue: classPrimitive.value,
    classPrimitiveWeakmaps: classPrimitive.weakmaps, classPrimitiveWeaksets: classPrimitive.weaksets, classObjectRenders: classObject.renders, classObjectCalls: classObject.calls,
    classObjectValue: classObject.value, classObjectWeakmaps: classObject.weakmaps, classObjectWeaksets: classObject.weaksets, classClassValueValid: classPrimitive.value === '0' && classObject.value === '0', done: true,
});

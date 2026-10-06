/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R32-01: containers built from draft branches (map/filter/spread) must not store engine views
// in state, and the diff of a leaking assignment must not read opaque fields through views.
// Args: [rows=10000]
import {emit, load, median} from '../../harness/lib.mjs';

const {Carburetor} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 10000);
const RAW_TARGET = Symbol.for('react-carburetor.rawTarget');
const AT = new Date(2020, 0, 1);

const makeRows = () => Array.from({length: rows}, (_, id) => ({id, title: `t${id}`, at: AT, tags: {a: id}}));
const reset = s => s.setData({rows: makeRows(), meta: {title: 'm'}, other: 0});

// Engine views reachable from state: objects answering the RAW_TARGET hatch. Reading the hatch
// is answered before any trap bookkeeping, so the walk itself records nothing.
const countViews = root => {
    let views = 0;
    const walk = node => {
        if (node === null || typeof node !== 'object') return;
        const raw = node[RAW_TARGET];
        if (raw !== undefined) { views++; node = raw; }
        for (const key of Object.keys(node)) walk(node[key]);
    };
    walk(root);
    return views;
};

const s = new S({rows: makeRows(), meta: {title: 'm'}, other: 0});
let wakes = 0;
s.subscribe(() => { wakes++; }, {reads: ['rows.5000.at']});
const original = s.getData().rows[2];
const initialIds = makeRows().map(row => row.id).join(',');

wakes = 0;
s.run(d => { d.rows = d.rows.map(r => r); });
const proxiesAfterMap = countViews(s.getData().rows);
const identitiesKept = s.getData().rows[2] === original;
const mapIdsOk = s.getData().rows.map(row => row.id).join(',') === initialIds;
const mapWakes = wakes;
reset(s);

wakes = 0;
s.run(d => { d.rows = d.rows.map(r => r.id === 1 ? {...r, title: 'x'} : r); });
const proxiesAfterSpread = countViews(s.getData().rows);
const spreadTitleOk = s.getData().rows[1].title === 'x' && s.getData().rows[2].title === 't2';
const spreadWakes = wakes;
reset(s);

wakes = 0;
s.run(d => { d.rows = d.rows.filter(r => r.id !== 1); });
const proxiesAfterFilter = countViews(s.getData().rows);
const filterRemovedOk = s.getData().rows.length === rows - 1 && s.getData().rows[1].id === 2;
reset(s);

wakes = 0;
s.run(d => { d.meta = {...d.meta, extra: d.rows[0]}; });
const proxiesAfterMeta = countViews(s.getData().meta);
const contentIntact = s.getData().meta.extra.title === 't0' && s.getData().meta.extra.at === AT;

// Probe self-check: the hatch-based counter must see a real read view before its zeros are
// trusted (on builds without the hatch the counter is blind and this control fails).
const probeSeesViews = countViews(s.read(() => undefined).rows) > 0;

// Steady-state assignment costs, for the runner's --against comparison.
const viewStore = new S({rows: makeRows(), other: 0});
const rawStore = new S({rows: makeRows(), other: 0});
global.gc?.();
const viewMs = [];
const rawMs = [];
for (let round = 0; round < 25; round++) {
    let start = performance.now();
    viewStore.run(d => { d.rows = d.rows.map(r => r); });
    viewMs.push(performance.now() - start);
    const fresh = makeRows();
    start = performance.now();
    rawStore.run(d => { d.rows = fresh; });
    rawMs.push(performance.now() - start);
}
emit({
    proxiesAfterMap, proxiesAfterSpread, proxiesAfterFilter, proxiesAfterMeta,
    identitiesKept, mapIdsOk, spreadTitleOk, filterRemovedOk, contentIntact,
    mapWakes, spreadWakes, probeSeesViews,
    viewAssignMs: median(viewMs), rawAssignMs: median(rawMs),
});

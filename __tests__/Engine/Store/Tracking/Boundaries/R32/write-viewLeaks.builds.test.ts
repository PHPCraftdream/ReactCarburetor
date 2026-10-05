// R32-01 in both built formats: the same leak patterns against dist/esm (development) and
// dist/esm-prod (production). Each build runs in its own child process, like the dual-format
// suite. Requires `npm run build` first.
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';

const CJS_ROOT = path.resolve(process.cwd(), 'dist', 'cjs');
const CJS_PROD_ROOT = path.resolve(process.cwd(), 'dist', 'cjs-prod');

const CHILD = `
const path = require('node:path');
const {types} = require('node:util');
const root = process.env.BUILD_ROOT;
const {Carburetor} = require(path.join(root, 'Carburetor', 'index.js'));

class Store extends Carburetor {
    run(fn) { this.update(fn); }
}

const makeRow = id => ({id, title: 'row' + id, tags: {a: id}});
const makeData = () => ({rows: [makeRow(0), makeRow(1), makeRow(2)], meta: {label: 'm'}, other: 0});

const countProxies = (value, stack = new Set()) => {
    if (value === null || typeof value !== 'object' || stack.has(value)) return 0;
    stack.add(value);
    let found = types.isProxy(value) ? 1 : 0;
    if (Array.isArray(value)) {
        for (const entry of value) found += countProxies(entry, stack);
    } else {
        for (const key of Object.keys(value)) found += countProxies(value[key], stack);
    }
    return found;
};

const assert = (condition, message) => { if (!condition) throw new Error(message); };

// map(r => r): raw rows, identity preserved.
const mapStore = new Store(makeData());
const original = mapStore.getData().rows[1];
mapStore.run(d => { d.rows = d.rows.map(r => r); });
assert(countProxies(mapStore.getData()) === 0, 'map left a proxy in state');
assert(mapStore.getData().rows[1] === original, 'map lost row identity');

// map replacing one row: nested copies normalized.
const nestedStore = new Store(makeData());
nestedStore.run(d => { d.rows = d.rows.map(r => r.id === 1 ? {...r, title: 'x'} : r); });
assert(countProxies(nestedStore.getData()) === 0, 'nested copy left a proxy');
assert(nestedStore.getData().rows[1].tags === nestedStore.getData().rows[1].tags, 'tags identity');

// filter, spread, concat, push-copy, meta spread.
const filterStore = new Store(makeData());
const kept = filterStore.getData().rows[2];
filterStore.run(d => { d.rows = d.rows.filter(r => r.id !== 1); });
assert(countProxies(filterStore.getData()) === 0, 'filter left a proxy');
assert(filterStore.getData().rows[1] === kept, 'filter lost identity');

const spreadStore = new Store(makeData());
spreadStore.run(d => { d.rows = [...d.rows, makeRow(3)]; });
assert(countProxies(spreadStore.getData()) === 0, 'spread left a proxy');

const concatStore = new Store(makeData());
concatStore.run(d => { d.rows = d.rows.concat([makeRow(3)]); });
assert(countProxies(concatStore.getData()) === 0, 'concat left a proxy');

const pushStore = new Store(makeData());
pushStore.run(d => { d.rows.push({...d.rows[0]}); });
assert(countProxies(pushStore.getData()) === 0, 'push copy left a proxy');

const metaStore = new Store(makeData());
metaStore.run(d => { d.meta = {...d.meta, first: d.rows[0]}; });
assert(countProxies(metaStore.getData()) === 0, 'meta spread left a proxy');
assert(metaStore.getData().meta.first === metaStore.getData().rows[0], 'meta identity');

// An opaque read followed by unrelated writes wakes nobody.
const wakeData = makeData();
wakeData.rows = [{id: 0, title: 'a', at: new Date(0)}, {id: 1, title: 'b', at: new Date(1)}];
const wakeStore = new Store(wakeData);
let wakes = 0;
wakeStore.subscribe(() => { wakes++; }, {reads: new Set(['rows.1.at'])});
wakeStore.read(() => undefined).rows[1].at;
wakeStore.run(d => { d.rows = d.rows.map(r => r); });
wakeStore.run(d => { d.other = 1; });
assert(wakes === 0, 'unrelated writes woke the opaque reader: ' + wakes);

// Positional filter plus a write at the shifted row's new index wakes only that index.
const posData = makeData();
const moved = makeRow(2);
posData.rows = [makeRow(0), makeRow(1), moved];
const posStore = new Store(posData);
let lowWakes = 0;
let highWakes = 0;
posStore.subscribe(() => { lowWakes++; }, {reads: new Set(['rows.1.title'])});
posStore.subscribe(() => { highWakes++; }, {reads: new Set(['rows.2.title'])});
posStore.read(() => undefined).rows[1].title;
posStore.read(() => undefined).rows[2].title;
posStore.run(d => { d.rows = d.rows.filter(r => r.id !== 0); });
const afterFilterLow = lowWakes;
const afterFilterHigh = highWakes;
posStore.run(d => { d.rows[0].title = 'moved-in'; });
assert(posStore.getData().rows[1] === moved, 'positional identity');
assert(highWakes === afterFilterHigh, 'old-index reader woken by the new index write');
assert(lowWakes === afterFilterLow, 'shifted-index reader woken by another index');

// A caller-built root through setData normalizes views.
const rootStore = new Store(makeData());
const view = rootStore.read(() => undefined);
rootStore.setData({rows: view.rows.map(r => r), meta: {}, other: 0});
assert(countProxies(rootStore.getData()) === 0, 'setData left a proxy in state');

console.log('OK');
`;

describe('R32-01 across built formats', () => {
    for (const [label, buildRoot] of [['development', CJS_ROOT], ['production', CJS_PROD_ROOT]] as const) {
        it(`stores no engine views in state (${label})`, () => {
            const child = spawnSync(process.execPath, ['-e', CHILD], {
                encoding: 'utf8',
                env: {...process.env, BUILD_ROOT: buildRoot},
            });
            if (child.status !== 0) {
                throw new Error(`${label} child failed: ${child.stderr || child.error || child.stdout}`);
            }
            expect(child.stdout).toContain('OK');
        });
    }

    it('both builds are present (run npm run build first)', () => {
        expect(existsSync(path.join(CJS_ROOT, 'Carburetor', 'index.js'))).toBe(true);
        expect(existsSync(path.join(CJS_PROD_ROOT, 'Carburetor', 'index.js'))).toBe(true);
    });
});

/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R32-03: native positional array methods must record index-level write paths, not field-diff
// every shifted element. Paths and woken readers are exact mechanism counters, and every
// operation's result is compared with the same operation on a plain JS array.
// Args: [rows=10000] [subs=0|1]
import {emit, load, median} from '../../harness/lib.mjs';

const {Carburetor} = await load();
class S extends Carburetor {
    constructor(...args) { super(...args); this.paths = 0; }
    recordWrite(path) { this.paths++; super.recordWrite(path); }
    run(fn) { this.update(fn); }
}

const rows = Number(process.argv[2] ?? 10000);
const withSubs = (process.argv[3] ?? '0') === '1';
const WARMUP = 2;
const ROUNDS = 5;
const makeRows = () => Array.from({length: rows}, (_, n) =>
    ({id: n, title: 't' + n, done: n % 2 === 0, a: n * 3, b: n % 5, c: 10 - n}));
const NEW_ROW = {id: -1, title: 'n', done: false, a: 0, b: 0, c: 0};
const byIdDesc = (x, y) => y.id - x.id;

// The same operations on a plain JS array: the store result must match exactly.
const MIRRORS = {
    spliceHead: list => list.splice(0, 1),
    spliceMid: list => list.splice(5000, 1),
    shift: list => list.shift(),
    unshift: list => list.unshift({...NEW_ROW}),
    reverse: list => list.reverse(),
    sort: list => list.sort(byIdDesc),
};
const OPS = {
    spliceHead: draft => { draft.rows.splice(0, 1); },
    spliceMid: draft => { draft.rows.splice(5000, 1); },
    shift: draft => { draft.rows.shift(); },
    unshift: draft => { draft.rows.unshift({...NEW_ROW}); },
    reverse: draft => { draft.rows.reverse(); },
    sort: draft => { draft.rows.sort(byIdDesc); },
};

const store = new S({rows: makeRows(), other: 0});
const woken = new Set();
let otherWakes = 0;
if (withSubs) {
    for (let index = 0; index < rows; index++) {
        store.subscribe(() => woken.add(index), {id: 'r' + index, reads: ['rows.' + index + '.title']});
    }
    store.subscribe(() => otherWakes++, {id: 'other', reads: ['other']});
}

const metrics = {};
let correct = true;
for (const [name, op] of Object.entries(OPS)) {
    const ms = [];
    let paths = 0;
    let opWoken = 0;
    let opOtherWakes = 0;
    for (let round = 0; round < WARMUP + ROUNDS; round++) {
        store.setData({rows: makeRows(), other: 0});
        store.paths = 0;
        woken.clear();
        otherWakes = 0;
        const start = performance.now();
        store.run(op);
        if (round >= WARMUP) {
            ms.push(performance.now() - start);
            paths = store.paths;
            opWoken = woken.size;
            opOtherWakes = otherWakes;
        }
        const mirror = makeRows();
        MIRRORS[name](mirror);
        const live = store.getData().rows;
        correct &&= live.length === mirror.length
            && live.every((row, index) => row.id === mirror[index].id && row.title === mirror[index].title);
    }
    metrics[name + 'Ms'] = median(ms);
    metrics[name + 'Paths'] = paths;
    metrics[name + 'Woken'] = opWoken;
    if (withSubs) metrics[name + 'OtherWakes'] = opOtherWakes;
}
metrics.correct = correct;
metrics.subs = withSubs;
emit(metrics);

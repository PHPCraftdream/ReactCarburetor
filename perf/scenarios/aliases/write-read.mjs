/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// 470a912 (scalar-alias-index fix): scalar writes keep the native-alias index — write/read cycles pay no root search or
// rebuild, through EITHER descriptor primitive. Args: [rows=4000] [cycles=64]
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 4000);
const cycles = Number(process.argv[3] ?? 64);
const rows_ = Array.from({length: rows}, (_, n) => ({n}));
const root = {rows: rows_, map: new Map(rows_.map((row, index) => [index, row]))};
const s = new S(root);
const originals = new Set(rows_);
const paths = new Set();
let value = 0;
let identical = true;
let diverged = false;

// Count descriptor reflection on the raw root and rows through both primitives across the whole
// write/read cycle loop: an engine reading descriptors via Object must be caught like Reflect's.
const rawReflect = Reflect.getOwnPropertyDescriptor;
const rawObject = Object.getOwnPropertyDescriptor;
let rootVisits = 0;
let rowVisits = 0;
const visit = object => {
    if (object === root) rootVisits++;
    if (originals.has(object)) rowVisits++;
};
Reflect.getOwnPropertyDescriptor = function (object, key) {
    visit(object);
    return rawReflect(object, key);
};
Object.getOwnPropertyDescriptor = function (object, key) {
    visit(object);
    return rawObject(object, key);
};

global.gc?.();
const start = performance.now();
try {
    for (let cycle = 0; cycle < cycles; cycle++) {
        s.run(draft => { draft.rows[0].n = ++value; });
        const view = s.read(path => paths.add(path));
        const member = view.map.get(1);
        if (member !== rows_[1]) identical = false;
        if (member.n !== rows_[1].n) diverged = true;
    }
} finally {
    Reflect.getOwnPropertyDescriptor = rawReflect;
    Object.getOwnPropertyDescriptor = rawObject;
}
const cycleMs = performance.now() - start;

const pathsOk = paths.has('map') && paths.has('rows.1');
const writeLanded = rows_[0].n === value;
const intact = identical && !diverged;
emit({cycleMs, rootVisits, rowVisits, pathsOk, writeLanded, intact});

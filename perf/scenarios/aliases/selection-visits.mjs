/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R19-ENGINE-01/R30-01: one keyed selection reflects each row a bounded number of times through EITHER
// descriptor primitive (Reflect or Object — counting one would go blind if the engine switched),
// and a repeat selection re-walks nothing. Args: [rows=128]
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 128);
const rows_ = Array.from({length: rows}, (_, n) => ({n}));
const root = {rows: rows_, map: new Map(rows_.map((row, index) => [index, row]))};
const s = new S(root);
const originals = new Set(rows_);

// Count descriptor reflection on the raw root and the raw rows during a selection phase.
let rootVisits = 0;
let rowVisits = 0;
const countPhase = fn => {
    rootVisits = 0;
    rowVisits = 0;
    const rawReflect = Reflect.getOwnPropertyDescriptor;
    const rawObject = Object.getOwnPropertyDescriptor;
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
    try {
        return fn();
    } finally {
        Reflect.getOwnPropertyDescriptor = rawReflect;
        Object.getOwnPropertyDescriptor = rawObject;
    }
};

const checksum = () => {
    const paths = new Set();
    let identical = true;
    let total = 0;
    const view = s.read(path => paths.add(path));
    for (let index = 0; index < rows; index++) {
        const member = view.map.get(index);
        if (member !== rows_[index]) identical = false;
        total += member.n;
    }
    return {identical, total};
};

const first = countPhase(checksum);
const firstRootVisits = rootVisits;
const firstRowVisits = rowVisits;
const second = countPhase(checksum); // no writes in between: must hit the per-read answer cache
const secondRootVisits = rootVisits;
const secondRowVisits = rowVisits;
const checksumOk = first.total === (rows * (rows - 1)) / 2 && second.total === (rows * (rows - 1)) / 2;

emit({
    firstRootVisits,
    firstRowVisits,
    secondRootVisits,
    secondRowVisits,
    checksumOk,
    identical: first.identical && second.identical,
});

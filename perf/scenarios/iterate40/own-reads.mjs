import {emit, load, median} from '../../harness/lib.mjs';
import {sameReads} from './sameReads.mjs';
const {Carburetor} = await load();
const n = 1_000_000;
const objectReads = new Set(), arrayReads = new Set();
const objectLeaf = new Carburetor({object: {leaf: 17}}).read(path => objectReads.add(path)).object;
const array = new Carburetor({array: [17]}).read(path => arrayReads.add(path)).array;
objectReads.clear();
arrayReads.clear();
const leafKey = '__iterate40_own_probe_leaf_7f3b__';
const probeLeafReads = new Set(), probeIndexReads = new Set();
const probeLeaf = new Carburetor({object: {[leafKey]: 17}})
    .read(path => probeLeafReads.add(path)).object;
const probeIndex = new Carburetor({array: [17]}).read(path => probeIndexReads.add(path)).array;
probeLeafReads.clear();
probeIndexReads.clear();
const originalHas = Map.prototype.has, originalGet = Map.prototype.get;
const control = new Map([[leafKey, 17]]);
let ownTableProbes = 0, probeControl = 0, controlHits = 0;
let probeLeafChecksum = 0, probeIndexChecksum = 0;
let controlling = false;
try {
    Map.prototype.has = function(key) {
        if (key === leafKey || key === '0') {
            if (controlling) probeControl++;
            else ownTableProbes++;
        }
        return Reflect.apply(originalHas, this, [key]);
    };
    Map.prototype.get = function(key) {
        if (key === leafKey || key === '0') {
            if (controlling) probeControl++;
            else ownTableProbes++;
        }
        return Reflect.apply(originalGet, this, [key]);
    };
    for (let i = 0; i < 1000; i++) {
        probeLeafChecksum += probeLeaf[leafKey];
        probeIndexChecksum += probeIndex[0];
    }
    controlling = true;
    for (let i = 0; i < 1000; i++) if (control.has(leafKey)) controlHits++;
} finally {
    Map.prototype.has = originalHas;
    Map.prototype.get = originalGet;
}
const objectSamples = [], arraySamples = [];
let objectLeafChecksum = 0, arrayIndexChecksum = 0, timingCorrect = true;
for (let batch = 0; batch < 7; batch++) {
    objectReads.clear();
    arrayReads.clear();
    objectLeafChecksum = 0;
    arrayIndexChecksum = 0;
    const objectStart = performance.now();
    for (let i = 0; i < n; i++) objectLeafChecksum += objectLeaf.leaf;
    const objectElapsed = performance.now() - objectStart;
    const arrayStart = performance.now();
    for (let i = 0; i < n; i++) arrayIndexChecksum += array[0];
    const arrayElapsed = performance.now() - arrayStart;
    timingCorrect &&= objectLeafChecksum === 17_000_000 && arrayIndexChecksum === 17_000_000
        && sameReads(objectReads, ['object.leaf']) && sameReads(arrayReads, ['array.0']);
    if (batch >= 2) {
        objectSamples.push(objectElapsed * 1_000_000 / n);
        arraySamples.push(arrayElapsed * 1_000_000 / n);
    }
}
const exactReads = sameReads(objectReads, ['object.leaf']) && sameReads(arrayReads, ['array.0'])
    && sameReads(probeLeafReads, ['object.' + leafKey]) && sameReads(probeIndexReads, ['array.0']);
emit({objectLeafNs: median(objectSamples), arrayIndexNs: median(arraySamples),
    ownTableProbes, probeControl, objectLeafChecksum, arrayIndexChecksum,
    probeLeafChecksum, probeIndexChecksum, exactReads,
    correct: timingCorrect && exactReads && probeLeafChecksum === 17_000 && probeIndexChecksum === 17_000
        && controlHits === 1000 && probeControl === 1000
        && Map.prototype.has === originalHas && Map.prototype.get === originalGet});

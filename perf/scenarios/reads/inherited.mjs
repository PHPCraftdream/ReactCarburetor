/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R12-E02: reading an inherited plain-object key records its path (an own-key write must wake); array methods stay untracked. Args: [repetitions=20000] [views=2000]
import {emit, load, loadPath, median} from '../../harness/lib.mjs';

const {Carburetor, computed} = await load();
const {createReadProxy} = await loadPath('Carburetor/Store/Tracking/createReadProxy.mjs');
class S extends Carburetor { run(fn) { this.update(fn); } }

const repetitions = Number(process.argv[2] ?? 20000);
const views = Number(process.argv[3] ?? 2000);

// Inherited key read: must record its precise path, exactly once.
let recorded = 0;
const inheritedView = createReadProxy({}, () => { recorded++; });
void inheritedView.toString;
const inheritedRecords = recorded;

// Shadow wake end to end: an own-key write to the inherited name must wake the computed.
const s = new S({});
const shadow = computed(read => String(read(s).toString));
let wakes = 0;
shadow.subscribe(() => { wakes++; });
const initialValue = shadow.get();
s.run(d => { d.toString = 7; });
const shadowValue = shadow.get();
const shadowWake = wakes;

// Array prototype methods stay untracked: answered without a path record.
let methodRecords = 0;
const arrayView = createReadProxy([2, 3], () => { methodRecords++; });
const methodIdentity = arrayView.map === Array.prototype.map && arrayView.filter === Array.prototype.filter;
void arrayView.map;
void arrayView.filter;
const methodsRecorded = methodRecords;

// Own leaves record once per proxy; time repeated reads of both leaves.
// Own leaves record once per proxy: the recorded path set holds one entry per distinct path.
const leafPaths = new Set();
const leafView = createReadProxy({left: 3, right: 4}, path => { leafPaths.add(path); });
void leafView.left;
void leafView.right;
const ownLeafRecords = leafPaths.size;
const leafTimes = [];
for (let i = 0; i < 9; i++) {
    const start = performance.now();
    let sum = 0;
    for (let r = 0; r < repetitions; r++) sum += leafView.left + leafView.right;
    leafTimes.push(performance.now() - start);
    if (sum !== 7 * repetitions) throw new Error(`leaf sum mismatch: ${sum}`);
}
const ownLeafMs = median(leafTimes);

// Array indices and length each record once: three distinct recorded paths.
const indexPaths = new Set();
const indexView = createReadProxy([2, 3], path => { indexPaths.add(path); });
void indexView[0];
void indexView[1];
void indexView.length;
const indexRecords = indexPaths.size;

// Construction + leaf read cost: one record per created proxy, sum verified.
let constructRecords = 0;
const record = () => { constructRecords++; };
let leafSum = 0;
const start = process.hrtime.bigint();
for (let i = 0; i < views; i++) leafSum += createReadProxy({leaf: i}, record).leaf;
const constructMs = Number(process.hrtime.bigint() - start) / 1e6;

emit({
    inheritedRecords, shadowWake, shadowValue, initialValue,
    methodIdentity, methodsRecorded,
    ownLeafRecords, ownLeafMs, indexRecords,
    constructRecords, leafSum, constructMs,
});

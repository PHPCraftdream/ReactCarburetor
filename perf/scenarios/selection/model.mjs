/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R30-03/04: selections compare and copy as plain data — no descriptor walks, an unchanged
// detached Date is EQUAL while a changed one is not, and genuinely different selections answer
// CHANGED, so an always-equal comparison cannot pass. Args: [iterations=200000] [rounds=11] [mode=plain|date]
import {emit, load, loadPath, median} from '../../harness/lib.mjs';

const {Carburetor} = await load();
const {sameSelection} = await loadPath('Carburetor/Component/Connection/sameSelection.mjs');
const {detachSelection} = await loadPath('Carburetor/Component/Connection/detachSelection.mjs');
class S extends Carburetor { run(fn) { this.update(fn); } }

const iterations = Number(process.argv[2] ?? 200000);
const rounds = Number(process.argv[3] ?? 11);
const mode = process.argv[4] ?? 'plain';

const store = new S({title: 'title-7', at: new Date(1000), payload: {n: 1}});
const twoFieldSelect = data => ({title: data.title, payload: data.payload});
const dateSelect = data => ({title: data.title, at: data.at});

// Verdicts, positive and negative. Detach must return an independent copy that preserves content;
// a different value, key order, key count or class instance must answer CHANGED.
class Widget { constructor() { this.n = 1; } }
const PLAIN_SOURCE = {title: 'title-7', payload: {n: 1}};
const detachCopy = detachSelection(PLAIN_SOURCE);
const detachIndependent = detachCopy !== PLAIN_SOURCE && detachCopy.payload !== PLAIN_SOURCE.payload
    && detachCopy.payload.n === 1 && detachCopy.title === 'title-7';
const detachRoundtrip = sameSelection(PLAIN_SOURCE, detachCopy);
const differentTitle = sameSelection({title: 'a', payload: {n: 1}}, {title: 'b', payload: {n: 1}});
const differentPayload = sameSelection(PLAIN_SOURCE, {title: 'title-7', payload: {n: 2}});
const differentKeyOrder = sameSelection({title: 'title-7', payload: {n: 1}}, {payload: {n: 1}, title: 'title-7'});
const differentKeyCount = sameSelection(PLAIN_SOURCE, {title: 'title-7', payload: {n: 1}, extra: 1});
const differentClassInstance = sameSelection(PLAIN_SOURCE, {title: 'title-7', payload: new Widget()});
const dateVerdict = sameSelection(
    detachSelection(dateSelect(store.read(() => undefined))),
    dateSelect(store.read(() => undefined)),
);
const dateChangedVerdict = sameSelection(
    detachSelection(dateSelect(store.read(() => undefined))),
    {title: 'title-7', at: new Date(2000)},
);

// Count descriptor/ownKeys reflection on the known fixture objects: the pre-R30-04 walks
// enumerated Reflect.ownKeys and read descriptors per key; the plain-data model uses direct
// reads, which stay uncounted. Both descriptor primitives are watched.
const fixtures = new Set();
const noteFixtures = (...objects) => {
    for (const object of objects) {
        fixtures.add(object);
        if (object && typeof object === 'object') for (const value of Object.values(object)) {
            if (value && typeof value === 'object') fixtures.add(value);
        }
    }
};
let visits = 0;
const originalOwnKeys = Reflect.ownKeys;
const originalReflectDesc = Reflect.getOwnPropertyDescriptor;
const originalObjectDesc = Object.getOwnPropertyDescriptor;
const counted = (original, thisArg, args) => {
    if (fixtures.has(args[0])) visits++;
    return original.apply(thisArg, args);
};
Reflect.ownKeys = function (...args) { return counted(originalOwnKeys, Reflect, args); };
Reflect.getOwnPropertyDescriptor = function (...args) { return counted(originalReflectDesc, Reflect, args); };
Object.getOwnPropertyDescriptor = function (...args) { return counted(originalObjectDesc, Object, args); };

let sink = 0;
noteFixtures(PLAIN_SOURCE);
// timeOnce: times `rounds` batches of `iterations` body calls and returns the median per-op ms.
const timeOnce = (count, body) => {
    const batch = [];
    for (let r = 0; r < rounds; r++) {
        const begin = process.hrtime.bigint();
        body(count);
        batch.push(Number(process.hrtime.bigint() - begin) / 1e6 / count);
    }
    return median(batch);
};

let compareMs = 0;
let detachMs = 0;
let dateMs = 0;
let samePlain = true;
let compareDescriptorVisits = 0;
let detachDescriptorVisits = 0;
let dateDescriptorVisits = 0;
if (mode === 'date') {
    const datePrevious = detachSelection(dateSelect(store.read(() => undefined)));
    const dateFresh = dateSelect(store.read(() => undefined));
    noteFixtures(datePrevious, dateFresh);
    const dateBody = count => {
        for (let i = 0; i < count; i++) {
            const verdict = sameSelection(datePrevious, dateFresh);
            sink += (datePrevious.title?.length ?? 0) + (verdict ? 1 : 0);
        }
    };
    dateBody(1);
    dateMs = timeOnce(iterations >> 1, dateBody);
    dateBody(100);
    dateDescriptorVisits = visits;
} else {
    const previous = detachSelection(twoFieldSelect(store.read(() => undefined)));
    const fresh = detachSelection(twoFieldSelect(store.read(() => undefined)));
    noteFixtures(previous, fresh);
    samePlain = sameSelection(previous, fresh);
    const compareBody = count => {
        for (let i = 0; i < count; i++) {
            const verdict = sameSelection(previous, fresh);
            sink += (previous.title?.length ?? 0) + (previous.payload?.n ?? 0) + (verdict ? 1 : 0);
        }
    };
    compareBody(1);
    compareMs = timeOnce(iterations, compareBody);
    compareBody(100);
    compareDescriptorVisits = visits;
    visits = 0;
    const detachBody = count => {
        for (let i = 0; i < count; i++) {
            const copy = detachSelection(PLAIN_SOURCE);
            sink += (copy.title?.length ?? 0) + (copy.payload?.n ?? 0);
        }
    };
    detachBody(1);
    detachMs = timeOnce(iterations, detachBody);
    detachBody(100);
    detachDescriptorVisits = visits;
}
Reflect.ownKeys = originalOwnKeys;
Reflect.getOwnPropertyDescriptor = originalReflectDesc;
Object.getOwnPropertyDescriptor = originalObjectDesc;

emit({
    compareMs, detachMs, dateMs,
    compareDescriptorVisits, detachDescriptorVisits, dateDescriptorVisits,
    samePlain, differentTitle, differentPayload, differentKeyOrder, differentKeyCount,
    differentClassInstance, detachIndependent, detachRoundtrip,
    dateVerdict, dateChangedVerdict,
});

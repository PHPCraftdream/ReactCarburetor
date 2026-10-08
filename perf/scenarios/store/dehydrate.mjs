/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R34-05: serializing a scope through dehydrate() against stringifying the stores' wire forms.
// Args: [rows=10000] [samples=15]
import {emit, load, median} from '../../harness/lib.mjs';
import {countCalls} from './pg-b1/count-calls.mjs';

const {Carburetor, CarburetorScope, carburetorToken} = await load();

const rows = Number(process.argv[2] ?? 10000);
const samples = Number(process.argv[3] ?? 15);
const token = carburetorToken(() => new Carburetor({
    rows: Array.from({length: rows}, (_, id) => ({id, title: `Row ${id}`, done: false, tags: {a: id}})),
}), 'rows');
const scope = new CarburetorScope();
const store = scope.get(token);

global.gc?.();
const viaDehydrate = [];
const viaWire = [];
const viaScope = typeof scope.toJSON === 'function' ? [] : null;
let same = true;
for (let i = 0; i < samples; i++) {
    let start = performance.now();
    const copied = JSON.stringify(scope.dehydrate());
    viaDehydrate.push(performance.now() - start);
    start = performance.now();
    const wire = JSON.stringify({[token.id]: store});
    viaWire.push(performance.now() - start);
    same &&= copied === wire;
    if (viaScope !== null) {
        start = performance.now();
        const viaToJson = JSON.stringify(scope);
        viaScope.push(performance.now() - start);
        same &&= viaToJson === copied;
    }
}
// Snapshot is the clone boundary used by dehydrate on both builds.
const empty = countCalls(store, 'snapshot', () => undefined);
const dehydrated = countCalls(store, 'snapshot', () => JSON.stringify(scope.dehydrate()));
const serialized = countCalls(store, 'snapshot', () => JSON.stringify(scope));
// Explicit synthetic control, never presented as a historical scope API.
const negativeScope = {toJSON: () => scope.dehydrate()};
const negative = countCalls(store, 'snapshot', () => JSON.stringify(negativeScope));
emit({
    scopeToJSONAvailable: viaScope !== null,
    scopeSnapshots: serialized.calls,
    scopePayloadMatchesDehydrate: serialized.value === dehydrated.value,
    scopePayloadBytes: Buffer.byteLength(serialized.value),
    dehydrateSnapshots: dehydrated.calls,
    emptySnapshots: empty.calls,
    negativeSnapshots: negative.calls,
    counterPayloadsEqual: negative.value === dehydrated.value
        && (viaScope === null || serialized.value === dehydrated.value),
    dehydrateStringifyMs: median(viaDehydrate),
    wireStringifyMs: median(viaWire),
    scopeStringifyMs: viaScope === null ? null : median(viaScope),
    samePayload: same,
});

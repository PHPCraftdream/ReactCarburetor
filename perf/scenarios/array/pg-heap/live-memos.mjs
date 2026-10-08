/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R32-04: observe both handler memo kinds through global Map.set, retaining only WeakRefs.
// For this 100-key rolling fixture, the oldest-128 sample has <half live by threshold 512:
// write audits start at 128, may double to 256, then clear; read audits include both kinds
// in their size, but trigger on childPaths at 128 (at most ~256 combined) and clear/reset.
// Even allowing two doublings and both handlers, <=2048 is conservative for this fixture,
// NOT a universal cap: dense live key sets legitimately keep doubling without clearing.
import {emit, load} from '../../../harness/lib.mjs';
const {Carburetor} = await load();
const withView = process.argv[2] === '1';
const store = new Carburetor({byId: {}});
const view = withView ? store.read(() => undefined) : undefined;
// A real dense short window exercises both memo kinds without crossing the 128 audit trigger.
// Keep its store AND read view alive through GC; no synthetic Map supplies the positive control.
const positiveStore = new Carburetor({byId: Object.fromEntries(
    Array.from({length: 32}, (_, index) => ['m' + index, {n: index}]))});
const positiveView = positiveStore.read(() => undefined);
const nativeSet = Map.prototype.set;
let refs = [];
const seen = new WeakSet();
let childPathEvents = 0;
let branchMarkerEvents = 0;
Map.prototype.set = function (key, value) {
    const kind = typeof key === 'string' && /^m\d+$/.test(key) && value === 'byId.' + key
        ? 'childPaths'
        : typeof key === 'string' && /^byId\.m\d+$/.test(key) && value === key + '.~p'
            ? 'branchMarkers' : undefined;
    if (kind) {
        if (kind === 'childPaths') childPathEvents++;
        else branchMarkerEvents++;
        if (!seen.has(this)) { seen.add(this); refs.push({kind, ref: new WeakRef(this)}); }
    }
    return nativeSet.call(this, key, value);
};
let positiveRefs;
let idleEvents;
let positiveValues = true;
let churnValues = true;
try {
    for (let index = 0; index < 32; index++) {
        positiveValues &&= positiveView.byId['m' + index].n === index;
    }
    positiveRefs = refs;
    refs = [];
    childPathEvents = 0;
    branchMarkerEvents = 0;
    void store.getVersion();
    idleEvents = childPathEvents + branchMarkerEvents;
    for (let index = 0; index < 200000; index++) {
        store.update(draft => {
            draft.byId['m' + index] = {n: index};
            if (index >= 100) delete draft.byId['m' + (index - 100)];
        });
        if (view) churnValues &&= view.byId['m' + index]?.n === index;
    }
} finally { Map.prototype.set = nativeSet; }
// WeakRefs keep targets alive for their current job. Yield before collecting abandoned Maps.
await new Promise(resolve => setImmediate(resolve));
global.gc(); global.gc();
const count = records => {
    const totals = {childPaths: 0, branchMarkers: 0, maps: 0};
    for (const {kind, ref} of records) {
        const map = ref.deref();
        if (map) { totals.maps++; totals[kind] += map.size; }
    }
    return totals;
};
const live = count(refs);
const positive = count(positiveRefs);
const data = store.getData().byId;
const windowHeld = Object.keys(data).length === 100;
const spotOk = data.m199999?.n === 199999 && data.m199900?.n === 199900 && !('m199899' in data);
const viewSeesWindow = !view || (Object.keys(view.byId).length === 100
    && view.byId.m199999?.n === 199999 && view.byId.m199900?.n === 199900 && !('m199899' in view.byId));
const positiveCorrect = positiveValues && Object.keys(positiveStore.getData().byId).length === 32
    && positiveStore.getData().byId.m31.n === 31 && positiveView.byId.m0.n === 0
    && positiveView.byId.m31.n === 31;
emit({liveMemoEntries: live.childPaths + live.branchMarkers, liveMemoMaps: live.maps,
    liveChildPathEntries: live.childPaths, liveBranchMarkerEntries: live.branchMarkers,
    memoEvents: childPathEvents + branchMarkerEvents, childPathEvents, branchMarkerEvents,
    positiveEntries: positive.childPaths + positive.branchMarkers,
    positiveChildPathEntries: positive.childPaths, positiveBranchMarkerEntries: positive.branchMarkers,
    positiveCorrect, idleEvents, windowHeld, spotOk, viewSeesWindow,
    done: windowHeld && spotOk && viewSeesWindow && churnValues && positiveCorrect, withView});

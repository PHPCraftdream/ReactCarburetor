/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// DevTools publication: every write publishes once, and every store name — a prototype-named one
// included — lands as an own key of the outgoing state carrying that store's snapshot.
// Args: [writes=500]
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor, connectDevTools} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const writes = Number(process.argv[2] ?? 500);
const counter = new S({value: 0});
const named = Object.fromEntries([['counter', counter], ['__proto__', new S({items: [0]})]]);
let sent = 0;
let initState;
let lastState;
const extension = {connect: () => ({
    init: state => { initState = state; },
    send: (action, state) => { sent++; lastState = state; },
    subscribe: () => () => undefined,
})};
const dispose = connectDevTools(named, {extension});
global.gc?.();
const start = performance.now();
for (let i = 1; i <= writes; i++) counter.setData({value: i});
const writeMs = performance.now() - start;
dispose();
const own = (state, key) => (state && Object.hasOwn(state, key) ? 1 : 0);
const snapshot = lastState && Object.hasOwn(lastState, '__proto__') ? lastState.__proto__ : undefined;
emit({
    writeMs, sent, initHasProto: own(initState, '__proto__'), stateHasProto: own(lastState, '__proto__'),
    stateHasCounter: own(lastState, 'counter'), lastValue: lastState ? lastState.counter.value : -1,
    protoIsSnapshot: snapshot && typeof snapshot === 'object' && 'items' in snapshot ? 1 : 0,
});

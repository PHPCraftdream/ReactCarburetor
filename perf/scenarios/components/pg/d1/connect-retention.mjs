/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// JS-R15-06: mounted connected rows vs otherwise identical plain rows, post-GC retention.
import {emit, load, setupReact, median} from '../../../../harness/lib.mjs';

const {React, root, flushSync, container} = await setupReact();
const {AntiHookComponent, Carburetor} = await load();
const store = new Carburetor({value: 7});
let plainReads = 0; let connectedReads = 0;
class Plain extends React.Component {
    render() { if (store.getData().value === 7) plainReads++; return React.createElement('span', null, '7'); }
}
class Connected extends AntiHookComponent {
    view = this.connect(store);
    render() { if (this.view.value === 7) connectedReads++; return React.createElement('span', null, '7'); }
}
const element = Class => React.createElement('div', null,
    Array.from({length: 4000}, (_, id) => React.createElement(Class, {key: id})));
const plain = element(Plain); const connected = element(Connected);
const mount = tree => flushSync(() => root.render(tree));
const clear = () => mount(null);
mount(plain); clear(); mount(connected); clear();
const heap = () => { globalThis.gc(); globalThis.gc(); return process.memoryUsage().heapUsed; };
const measure = tree => {
    clear(); const first = heap(); mount(tree); const bytes = heap() - first;
    return bytes / 4000;
};
const plainSamples = []; const connectedSamples = [];
for (let i = 0; i < 3; i++) {
    if (i % 2 === 0) { plainSamples.push(measure(plain)); connectedSamples.push(measure(connected)); }
    else { connectedSamples.push(measure(connected)); plainSamples.push(measure(plain)); }
}
const NativeProxy = globalThis.Proxy;
let proxies = 0; let ownTrapFunctions = 0;
const probe = fn => {
    globalThis.Proxy = new NativeProxy(NativeProxy, {construct(target, args) {
        proxies++;
        for (const key of ['get', 'has', 'ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf',
            'setPrototypeOf', 'preventExtensions', 'set', 'defineProperty', 'deleteProperty']) {
            if (Object.hasOwn(args[1], key) && typeof args[1][key] === 'function') ownTrapFunctions++;
        }
        return Reflect.construct(target, args);
    }});
    try { fn(); } finally { globalThis.Proxy = NativeProxy; }
};
probe(() => {}); const idleProxies = proxies;
clear(); probe(() => mount(connected));
const connectedProxies = proxies; const connectedOwnTraps = ownTrapFunctions;
proxies = 0; ownTrapFunctions = 0;
probe(() => { for (let i = 0; i < 4; i++) new Proxy({}, {get: () => 7, has: () => true}); });
const done = container.textContent === '7'.repeat(4000) && plainReads === 16000 && connectedReads === 20000;
clear();
emit({plainBytes: median(plainSamples), connectedBytes: median(connectedSamples), connectedProxies,
    connectedOwnTraps, idleProxies, controlProxies: proxies, controlOwnTraps: ownTrapFunctions, done});

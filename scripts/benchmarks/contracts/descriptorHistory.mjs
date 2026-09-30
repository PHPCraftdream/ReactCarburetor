import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const roots = {
    baseline: process.env.BASELINE_DIST,
    after: process.env.AFTER_DIST,
};
if (!roots.baseline || !roots.after) {
    throw new Error('Set BASELINE_DIST and AFTER_DIST to built dist directories');
}
const implementations = Object.fromEntries(Object.entries(roots).map(([name, root]) => {
    const dist = resolve(root);
    return [name, {
        Carburetor: require(resolve(dist, 'cjs/Carburetor/Store/Carburetor.js')).Carburetor,
        CarburetorHistory: require(resolve(dist, 'cjs/Carburetor/Tooling/CarburetorHistory.js')).CarburetorHistory,
    }];
}));

const rounds = 6;
const writes = 300;
const samples = {baseline: [], after: []};
for (let round = 0; round < rounds; round++) {
    // Alternate the sample order to limit warmup and host-load bias.
    for (const name of round % 2 ? ['after', 'baseline'] : ['baseline', 'after']) {
        const {Carburetor, CarburetorHistory} = implementations[name];
        class Store extends Carburetor {
            /** Mutates and publishes one history entry.
             *
             * @param mutate - synchronous draft operation
             */
            edit(mutate) { this.update(mutate); }
        }
        const source = {count: 0, items: [0], refused: 0};
        const store = new Store(source);
        const history = new CarburetorHistory(store, {limit: writes + 1});
        let delivered = 0;
        const subscription = store.subscribe(() => delivered++);
        const started = performance.now();
        for (let i = 1; i <= writes; i++) {
            store.edit(draft => {
                Object.defineProperty(draft, 'count', {value: i}); // Existing open flags stay open.
                Object.defineProperty(draft.items, String(i), {
                    value: i, writable: true, configurable: true, enumerable: true,
                });
            });
        }
        const writeMs = performance.now() - started;
        let undos = 0;
        const replayStart = performance.now();
        while (history.undo()) undos++;
        let redos = 0;
        while (history.redo()) redos++;
        const replayMs = performance.now() - replayStart;
        if (store.getData().count !== writes || store.getData().items.length !== writes + 1
            || store.getData().items[writes] !== writes || undos !== writes || redos !== writes) {
            throw new Error(`${name}: write/history invariant failed`);
        }
        store.unsubscribe(subscription);
        history.disconnect();
        samples[name].push({writeMs, replayMs, attemptedDefinitions: writes * 2,
            versions: store.getVersion(), delivered, undos, redos, finalLength: store.getData().items.length});
    }
}
for (const [implementation, rows] of Object.entries(samples)) {
    console.log(JSON.stringify({implementation, rounds, writes, samples: rows}));
}

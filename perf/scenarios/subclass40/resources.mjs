/* oxlint-disable carburetor-internal/require-tsdoc */
import {emit, load} from '../../harness/lib.mjs';
const {ResourceCache, ResourceCarburetor, CarburetorHistory} = await load();
const cacheOwn = Object.getOwnPropertyNames(new ResourceCache(async () => 1)).length;
const slotOwn = Object.getOwnPropertyNames(new ResourceCarburetor(async () => 1)).length;
let cacheCorrect = 0;
let slotCorrect = 0;
let controls = 0;
for (const name of ['ttl', 'loader', 'maxEntries', 'eviction', 'runtimeRecords', 'viewCache', 'fetch']) {
    for (const shadow of [false, true]) {
        const cache = new ResourceCache(async args => args, {ttl: Infinity});
        if (shadow) Object.defineProperty(cache, name, {value: 'domain', configurable: true, writable: true});
        const history = new CarburetorHistory(cache);
        let wakes = 0;
        const id = cache.subscribe(() => { wakes++; });
        try {
            await cache.load('answer');
            const loaded = cache.getEntry('answer').data;
            cache.forget('answer');
            history.undo();
            const correct = loaded === 'answer' && cache.getEntry('answer').data === 'answer' && wakes === 4;
            if (correct) { if (shadow) cacheCorrect++; else controls++; }
        } catch { /* Baseline collisions are verdict failures. */ }
        try { cache.unsubscribe(id); } catch { /* Baseline eviction shadow also breaks release. */ }
        history.disconnect();
    }
}
for (const name of ['loader', 'runtime', 'operationVersion', 'start', 'ensureRuntime']) {
    for (const shadow of [false, true]) {
        const slot = new ResourceCarburetor(async args => args);
        if (shadow) Object.defineProperty(slot, name, {value: 'domain', configurable: true, writable: true});
        let wakes = 0;
        const id = slot.subscribe(() => { wakes++; });
        try {
            await slot.load('answer');
            await slot.reload();
            const correct = slot.getData().data === 'answer' && wakes === 4;
            if (correct) { if (shadow) slotCorrect++; else controls++; }
        } catch { /* Baseline collisions are verdict failures. */ }
        slot.unsubscribe(id);
    }
}
emit({cacheOwn, slotOwn, cacheCorrect, slotCorrect, controls,
    done: cacheOwn === 0 && slotOwn === 0 && cacheCorrect === 7 && slotCorrect === 5 && controls === 12});

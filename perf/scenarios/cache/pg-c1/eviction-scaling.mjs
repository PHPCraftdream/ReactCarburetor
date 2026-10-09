/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// JS-R16-04: retained cold loads amortize eviction; fresh hits do no eviction work.
import {emit, loadPath, call, engine} from '../../../harness/lib.mjs';

const {ResourceCache} = await loadPath('Carburetor/Resource/Cache/ResourceCache.mjs');
const {EResourceStatus} = await loadPath('Carburetor/Models/Enums/EResourceStatus.mjs');
const count = Number(process.argv[2] ?? 1000);
let loaderCalls = 0;
const cache = new ResourceCache(key => {
    loaderCalls++;
    return Promise.resolve(`value-${key}`);
}, {ttl: Infinity});
const args = Array.from({length: count}, (_, index) => String(index));
// Subscribe outside the windows, exactly as the retained-row fixture does.
for (const key of args) {
    cache.subscribe(() => undefined, {id: key, reads: new Set([call(cache, 'pathOf', key)])});
}
// The pre-fix lifecycle owns lastUsed directly; no baseline-only module import.
const ledger = engine(cache, 'eviction')?.lastUsed ?? cache.lastUsed;
if (!(ledger instanceof Map)) throw new Error('Missing eviction access-order map');

const measure = async operation => {
    const originalKeys = Object.keys;
    const originalMapKeys = Map.prototype.keys;
    let dictionaryCalls = 0;
    let dictionaryVisits = 0;
    let ledgerVisits = 0;
    Object.keys = target => {
        const keys = originalKeys(target);
        if (target === cache.getData().entries) {
            dictionaryCalls++;
            dictionaryVisits += keys.length;
        }
        return keys;
    };
    Map.prototype.keys = function () {
        const iterator = originalMapKeys.call(this);
        if (this !== ledger) return iterator;
        return {
            next() {
                const result = iterator.next();
                if (!result.done) ledgerVisits++;
                return result;
            },
            [Symbol.iterator]() { return this; },
        };
    };
    const started = performance.now();
    try {
        await operation();
    } finally {
        Object.keys = originalKeys;
        Map.prototype.keys = originalMapKeys;
    }
    return {dictionaryCalls, dictionaryVisits, ledgerVisits,
        work: dictionaryVisits + ledgerVisits, ms: performance.now() - started};
};

const idle = await measure(() => undefined);
const cold = await measure(() => Promise.all(args.map(key => cache.load(key))));
const callsBeforeHits = loaderCalls;
const hits = await measure(() => Promise.all(args.map(key => cache.load(key))));
// Deliberate scans prove each global probe sees its exact target on both builds.
const probe = await measure(() => {
    Object.keys(cache.getData().entries);
    for (const key of ledger.keys()) void key;
});
const entries = cache.getData().entries;
const done = args.every(key => {
    const entry = entries[call(cache, 'keyOf', key)];
    return entry?.status === EResourceStatus.Success && entry.data === `value-${key}`;
});
emit({count, coldDictionaryCalls: cold.dictionaryCalls, coldDictionaryVisits: cold.dictionaryVisits,
    coldLedgerVisits: cold.ledgerVisits, coldWork: cold.work, coldWorkPerLoad: cold.work / count,
    hitDictionaryCalls: hits.dictionaryCalls, hitDictionaryVisits: hits.dictionaryVisits,
    hitLedgerVisits: hits.ledgerVisits, hitWork: hits.work,
    idleDictionaryCalls: idle.dictionaryCalls, idleLedgerVisits: idle.ledgerVisits,
    probeDictionaryCalls: probe.dictionaryCalls, probeDictionaryVisits: probe.dictionaryVisits,
    probeLedgerVisits: probe.ledgerVisits, loaderCalls, hitLoaderCalls: loaderCalls - callsBeforeHits,
    remainingEntries: Object.keys(entries).length, done, coldMs: cold.ms, hitMs: hits.ms});

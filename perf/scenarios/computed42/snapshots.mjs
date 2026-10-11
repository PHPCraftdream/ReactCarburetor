import {engine, loadPath} from '../../harness/lib.mjs';

const {computedDependencies} = await loadPath('Carburetor/Derived/computedDependencies.mjs');

/** Returns current captured dependency records for structural checks, not announcement history. */
export const records = value => Object.values(computedDependencies.versions.get(value)());

/**
 * Retains captured and announced record identities to detect later mutation.
 * Only listed fields and read paths are saved; source data is not deep-cloned.
 */
export const snapshot = value => {
    const captured = records(value);
    const announcement = engine(value, 'announced');
    const announced = announcement?.versions ? Object.values(announcement.versions) : [];
    return [...captured, ...announced].map(record => ({
        record, source: record.source, version: record.version, data: record.data,
        reads: record.reads, parts: record.parts,
        pairs: (record.parts ?? [record]).map(pair => ({
            pair, version: pair.version, reads: pair.reads,
            paths: Array.from(pair.reads ?? []).join('\n'),
        })),
    }));
};

/** Checks retained identity, version and read-path stability, not deep source-data equality. */
export const intact = captured => captured.every(saved => {
    const record = saved.record;
    if (record.source !== saved.source || record.version !== saved.version
        || record.data !== saved.data || record.reads !== saved.reads || record.parts !== saved.parts) return false;
    const pairs = record.parts ?? [record];
    return pairs.length === saved.pairs.length && saved.pairs.every((savedPair, index) => {
        const pair = pairs[index];
        return pair === savedPair.pair && pair.version === savedPair.version
            && pair.reads === savedPair.reads && Array.from(pair.reads ?? []).join('\n') === savedPair.paths;
    });
});

/**
 * Verifies no input source/version/read-set pair was lost during fan-in merging.
 * Extra output pairs are allowed; read sets are compared by identity, not contents.
 *
 * @param value - Merged computed value whose captured dependency records are checked.
 * @param inputs - Input computed values whose captured dependency pairs must appear in the merged value.
 */
export const covers = (value, inputs) => {
    const output = records(value);
    return inputs.every(input => records(input).every(record => {
        const target = output.find(candidate => candidate.source === record.source);
        if (!target) return false;
        const expected = record.parts ?? [record];
        const actual = target.parts ?? [target];
        return expected.every(pair => actual.some(candidate => candidate.version === pair.version
            && candidate.reads === pair.reads));
    }));
};

/** Counts captured pairs to check fan-in completeness, not unique paths or allocation work. */
export const pairCount = value => records(value).reduce((sum, record) => sum + (record.parts?.length ?? 1), 0);

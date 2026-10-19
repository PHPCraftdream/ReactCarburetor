// Past the diff threshold, diffPaths and applyDiff decide collapse versus precise with one counting
// pass (the restore scan counts on its own) instead of separate changed/total/per-key walks. The
// reference is the cost of one complete walk over the same instrumented rows.
import {TPatchRecorder} from '@/Carburetor/Models/Paths';
import {diffPaths} from '@/Carburetor/Store/Paths/Diff/diffPaths';
import {applyDiff} from '@/Carburetor/Store/Paths/Diff/applyDiff';
import {scanBranch} from '@/Carburetor/Store/Paths/Diff/Order/scanBranch';
import {DIFF_PATH_THRESHOLD} from '@/Carburetor/Store/Paths/Diff/Threshold/DIFF_PATH_THRESHOLD';
import {IReadCounter, instrument, rowPair} from './helpers';

type TRecord = Record<string, unknown>;
type TPatch = Parameters<TPatchRecorder>[0];

/** Reads of one diffPaths call over `count` rows whose first `changed` titles differ. */
const diffReads = (
    count: number, changed: number, root = false, patches?: TPatch[]
): {reads: number; paths: string[]} => {
    const counter: IReadCounter = {reads: 0};
    const {previous, next} = rowPair(count, changed);
    const memo = new Map<object, object>();
    const oldTree = instrument(root ? {rows: previous, unrelated: {value: 1}} : previous, counter, memo);
    const newTree = instrument(root ? {rows: next, unrelated: (oldTree as TRecord).unrelated} : next, counter, memo);
    counter.reads = 0;
    const paths = root ? diffPaths(oldTree, newTree, '', [], patches)
        : diffPaths(oldTree, newTree, 'rows', ['rows'], patches);
    return {reads: counter.reads, paths: [...paths]};
};

/** Reads of one restore (or of its scan alone) replacing the first `changed` of `count` rows. */
const restoreReads = (count: number, changed: number, scanOnly = false): {reads: number; applied: boolean} => {
    const counter: IReadCounter = {reads: 0};
    const rows = Array.from({length: count}, (_, title) => ({title}));
    const nextRows = rows.map((row, index) => (index < changed ? {title: row.title + 1} : row));
    const memo = new Map<object, object>();
    const previous = instrument({rows}, counter, memo) as TRecord;
    const next = instrument({rows: nextRows}, counter, memo) as TRecord;
    const target = {rows: rows.map(row => ({...row}))};
    counter.reads = 0;
    const applied = scanOnly
        ? scanBranch(previous, next, {unchanged: new Map<object, object>(), changes: 0}) !== 'blocked'
        : applyDiff(target, previous, next);
    return {reads: counter.reads, applied};
};

describe('fused diff threshold: reads past DIFF_PATH_THRESHOLD', () => {
    test('under the threshold one walk is all there is', () => {
        const walk = diffReads(1500, 0).reads;
        const full = diffReads(1500, 1500);
        expect(full.paths).toHaveLength(1500);
        expect(full.reads).toBeLessThanOrEqual(walk * 1.05);
    });

    test.each([2500, 10000])('a nested full replacement of %i rows collapses within 2.75 walks', count => {
        const walk = diffReads(count, 0).reads;
        const full = diffReads(count, count);
        expect(full.paths).toStrictEqual(['rows']);
        // One aborted prefix, normalization and one counting pass; before: three more counting walks.
        expect(full.reads / walk).toBeLessThanOrEqual(2.75);
    });

    test('a same-kind root collapse takes its woken keys from the counting pass', () => {
        const walk = diffReads(10000, 0, true).reads;
        const full = diffReads(10000, 10000, true);
        expect(full.paths).toStrictEqual(['rows']);
        expect(full.reads / walk).toBeLessThanOrEqual(2.5);
    });

    test('2500 changed of 10000 stays precise after one counting pass and one re-walk', () => {
        const walk = diffReads(10000, 0).reads;
        const partial = diffReads(10000, 2500);
        expect(partial.paths).toHaveLength(2500);
        expect(partial.paths[0]).toBe('rows.0.title');
        expect(partial.paths[2499]).toBe('rows.2499.title');
        expect(partial.reads / walk).toBeLessThanOrEqual(3.5);
    });

    test('the collapse buffer never outgrows the threshold', () => {
        let longest = 0;
        const patches = new Proxy<TPatch[]>([], {
            set: (target, key, value, receiver) => {
                const done = Reflect.set(target, key, value, receiver);
                longest = Math.max(longest, target.length);
                return done;
            },
        });
        expect(diffReads(10000, 10000, false, patches).paths).toStrictEqual(['rows']);
        expect(patches).toHaveLength(1);
        expect(longest).toBeLessThanOrEqual(DIFF_PATH_THRESHOLD + 1);
    });

    test('restore runs no counting walk after its scan', () => {
        const one = restoreReads(10000, 1);
        expect(one.applied).toBe(true);
        expect(one.reads / restoreReads(10000, 1, true).reads).toBeLessThanOrEqual(4.5);
        const full = restoreReads(10000, 10000);
        expect(full.applied).toBe(false);
        expect(full.reads / restoreReads(10000, 10000, true).reads).toBeLessThanOrEqual(3.25);
    });
});

// The fused threshold count must leave every diffPaths/applyDiff outcome exactly as the pre-change
// implementations (kept verbatim as oracles) produce it: paths and their order, patches, markers,
// restore verdicts and the installed branch.
import {Carburetor} from '@/Carburetor';
import {TPatchRecorder} from '@/Carburetor/Models/Paths';
import {diffPaths} from '@/Carburetor/Store/Paths/Diff/diffPaths';
import {applyDiff} from '@/Carburetor/Store/Paths/Diff/applyDiff';
import {scanBranch} from '@/Carburetor/Store/Paths/Diff/Order/scanBranch';
import {countDiffLeaves} from '@/Carburetor/Store/Paths/Diff/Threshold/countDiffLeaves';
import {countChanges} from '@/Carburetor/Store/Paths/Diff/Threshold/countChanges';
import {measureDiff} from '@/Carburetor/Store/Paths/Diff/Threshold/measureDiff';
import {shouldCollapseDiff} from '@/Carburetor/Store/Paths/Diff/Threshold/shouldCollapseDiff';
import {DIFF_PATH_THRESHOLD} from '@/Carburetor/Store/Paths/Diff/Threshold/DIFF_PATH_THRESHOLD';
import {types} from 'node:util';
import {copyTree, randomPair} from './helpers';
import {legacyDiffPaths} from './legacyDiffPaths';
import {legacyApplyDiff} from './legacyApplyDiff';
import {legacyScanBranch} from './legacyScanBranch';

type TRecord = Record<string, unknown>;
type TPatch = Parameters<TPatchRecorder>[0];

const SEEDS = Array.from({length: 120}, (_, index) => 7919 * (index + 1));
const BRANCHES = ['', 'rows', 'byId', 'nums', 'sparse'];

/** Every diffPaths delivery mode, through both implementations. */
const compareDiff = (previous: unknown, next: unknown, path: string, delivery = true): void => {
    const segments = path === '' ? [] : [path];
    expect([...diffPaths(previous, next, path, segments)])
        .toStrictEqual([...legacyDiffPaths(previous, next, path, segments)]);
    const collected: TPatch[] = [];
    const expected: TPatch[] = [];
    const paths = [...diffPaths(previous, next, path, segments, collected)];
    expect(paths).toStrictEqual([...legacyDiffPaths(previous, next, path, segments, expected)]);
    expect(collected).toStrictEqual(expected);
    if (!delivery) return;
    const delivered: TPatch[] = [];
    const legacyDelivered: TPatch[] = [];
    diffPaths(previous, next, path, segments, patch => { delivered.push(patch); });
    legacyDiffPaths(previous, next, path, segments, patch => { legacyDelivered.push(patch); });
    expect(delivered).toStrictEqual(legacyDelivered);
};

const outcome = (previous: unknown, next: unknown): 'collapse' | 'relative' | 'small' => {
    const changed = countDiffLeaves.changed(previous, next);
    if (shouldCollapseDiff(changed, countDiffLeaves.total(previous, next))) return 'collapse';
    return changed > DIFF_PATH_THRESHOLD ? 'relative' : 'small';
};

describe('fused diff threshold keeps the pre-change outcomes', () => {
    test('measureDiff equals the separate countDiffLeaves walks, root keys included', () => {
        for (const seed of SEEDS.slice(0, 60)) {
            const {previous, next} = randomPair(seed);
            for (const branch of BRANCHES) {
                const oldValue = branch === '' ? previous : previous[branch];
                const newValue = branch === '' ? next : next[branch];
                if (oldValue === undefined) continue;
                const wake: string[] = [];
                const measured = measureDiff(oldValue, newValue, branch === '' ? wake : undefined);
                expect(measured).toStrictEqual({
                    changed: countDiffLeaves.changed(oldValue, newValue),
                    total: countDiffLeaves.total(oldValue, newValue),
                });
                if (branch !== '') continue;
                const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
                expect(wake).toStrictEqual([...keys].filter(key =>
                    countDiffLeaves.changed(previous[key], next[key], true) > 0));
            }
        }
    });

    test('diffPaths matches the oracle on random trees on both sides of the relative threshold', () => {
        const seen = {collapse: 0, relative: 0, small: 0};
        for (const [index, seed] of SEEDS.slice(0, 60).entries()) {
            const {previous, next} = randomPair(seed);
            for (const branch of BRANCHES) {
                const oldValue = branch === '' ? previous : previous[branch];
                const newValue = branch === '' ? next : next[branch];
                if (oldValue === undefined) continue;
                seen[outcome(oldValue, newValue)]++;
                compareDiff(oldValue, newValue, branch, index % 4 === 0);
            }
        }
        expect(seen.collapse).toBeGreaterThanOrEqual(12);
        expect(seen.relative).toBeGreaterThanOrEqual(12);
        expect(seen.small).toBeGreaterThanOrEqual(100);
    });

    test('a partial change stays precise and a near-total one collapses, as before', () => {
        const rows = (count: number, changed: number): TRecord[] =>
            Array.from({length: count}, (_, id) => ({title: id < changed ? id + 1 : id}));
        for (const [count, changed] of [[3000, 1500], [3000, 2500], [10000, 2500], [10000, 5001], [10000, 10000]]) {
            const previous = {rows: rows(count, 0), unrelated: {value: 1}};
            const next = {rows: rows(count, changed), unrelated: previous.unrelated};
            compareDiff(previous, next, '');
            compareDiff(previous.rows, next.rows, 'rows');
        }
        const previous = rows(10000, 0);
        expect(diffPaths(previous, rows(10000, 2500), 'rows').size).toBe(2500);
        expect([...diffPaths(previous, rows(10000, 5001), 'rows')]).toStrictEqual(['rows']);
    });

    test('an array root and a kind change past the threshold match the oracle', () => {
        const previous = Array.from({length: 5000}, (_, id) => ({id}));
        const shifted = [...previous.slice(1), ...previous.slice(0, 1)].map((row, index) =>
            (index % 2 === 0 ? {id: row.id + 1} : row));
        compareDiff(previous, shifted, '');
        compareDiff(previous, previous.map(row => ({id: -row.id - 1})), '');
        compareDiff({a: previous}, {a: {...previous}}, '');
    });

    test('engine views past the threshold are exchanged exactly as before', () => {
        const build = (changed: number): {previous: TRecord; next: TRecord} => {
            const view = (): object => (new Carburetor({z: {n: 1}}).read(() => undefined) as {z: object}).z;
            const previous = {a: Array.from({length: 3000}, (_, id) => ({id})), b: {kept: 1}};
            const a: unknown[] = previous.a.map((row, index) => (index < changed ? {id: -1} : row));
            a[2999] = {nested: {deep: view()}};
            a[1] = view();
            return {previous, next: {a, b: {kept: 1, fresh: {inner: view()}}, c: [view(), {x: view()}]}};
        };
        const views = (value: unknown, path = '', into: string[] = []): string[] => {
            if (value === null || typeof value !== 'object') return into;
            if (types.isProxy(value)) into.push(path);
            else for (const [key, child] of Object.entries(value)) views(child, path + '.' + key, into);
            return into;
        };
        for (const changed of [2500, 1400]) {
            const left = build(changed);
            const right = build(changed);
            const paths = [...diffPaths(left.previous, left.next)];
            expect(paths).toStrictEqual([...legacyDiffPaths(right.previous, right.next)]);
            expect(views(left.next)).toStrictEqual(views(right.next));
            expect(left.next).toStrictEqual(right.next);
            // Past the threshold the whole assigned value is normalized; a precise walk exchanges what it visits.
            if (changed === 2500) expect(views(left.next)).toStrictEqual([]);
            else expect(views(left.next).length).toBeGreaterThan(0);
        }
    });

    test('scanBranch counts exactly the countChanges leaves and keeps its verdicts', () => {
        const verdicts = {blocked: 0, equal: 0, differ: 0};
        const check = (previous: TRecord, next: TRecord): void => {
            const budget = {unchanged: new Map<object, object>(), changes: 0};
            const verdict = scanBranch(previous, next, budget);
            const legacy = legacyScanBranch(previous, next, {unchanged: new Map<object, object>()});
            expect(verdict).toBe(legacy);
            verdicts[verdict]++;
            if (verdict !== 'blocked') expect(budget.changes).toBe(countChanges(previous, next));
        };
        for (const seed of SEEDS.slice(0, 60)) {
            const {previous, next} = randomPair(seed, seed % 4 !== 0);
            check(previous, next);
            const locked = copyTree(previous) as TRecord;
            Object.preventExtensions(locked);
            check(locked, next);
            const frozen = copyTree(previous) as TRecord;
            Object.freeze(frozen.misc);
            check(frozen, {...next, misc: {a: 2}});
        }
        const hidden: TRecord = {a: 1, list: [1, 2, 3]};
        Object.defineProperty(hidden, 'h', {value: {x: 1, y: [1, 2]}, enumerable: false, configurable: true});
        check(hidden, {a: 1, h: {x: 2, y: [1, 3, 4]}, list: [1, 2, 3, 4, 5]});
        check({a: 1, b: 2}, {a: 1, c: 2});
        check({list: [1, , 3]}, {list: [1, undefined, 3, , 5]});
        check({list: [1, 2, 3, 4]}, {list: [1]});
        expect(verdicts.blocked).toBeGreaterThan(0);
        expect(verdicts.differ).toBeGreaterThan(30);
    });

    test('applyDiff returns and installs what the oracle does', () => {
        const seen = {collapsed: 0, relative: 0, blocked: 0};
        const rows = (count: number, changed: number, extra = 0): TRecord => ({
            rows: Array.from({length: count + extra}, (_, id) => ({title: id < changed ? -id - 1 : id})),
            meta: {count},
        });
        const fixed = [[3000, 3000, 0], [5000, 2600, 0], [5000, 2400, 0], [4000, 0, 2500], [2500, 2500, 10]]
            .map(([count, changed, extra]) => ({previous: rows(count, 0), next: rows(count, changed, extra)}));
        const random = SEEDS.slice(0, 80).map(seed => randomPair(seed, seed % 5 !== 0));
        for (const {previous, next} of [...fixed, ...random]) {
            const left = copyTree(previous) as TRecord;
            const right = copyTree(previous) as TRecord;
            const applied = applyDiff(left, previous, next);
            expect(applied).toBe(legacyApplyDiff(right, previous, next));
            expect(left).toStrictEqual(right);
            const scanned = legacyScanBranch(previous, next, {unchanged: new Map<object, object>()});
            if (scanned === 'blocked') seen.blocked++;
            else if (countChanges(previous, next) > DIFF_PATH_THRESHOLD) seen[applied ? 'relative' : 'collapsed']++;
        }
        expect(seen.collapsed).toBeGreaterThanOrEqual(8);
        expect(seen.relative).toBeGreaterThanOrEqual(20);
        expect(seen.blocked).toBeGreaterThanOrEqual(10);
    });

    test('a hole reading an inherited index still counts as one own-index change', () => {
        const original = Object.getOwnPropertyDescriptor(Array.prototype, 0);
        const inherit = (value: unknown): void => {
            Object.defineProperty(Array.prototype, 0, {value, writable: true, configurable: true, enumerable: false});
        };
        const cases = [
            // Equal reads: every hole reads 7 like the assigned own 7; 2002 changes collapse.
            {value: (): unknown => 7, rows: 2001, next: (): unknown[] => [7], applies: false},
            // Same-kind reads: one change per row, not the inherited object's own diff; 1001 changes apply.
            {value: (): unknown => ({v: 1}), rows: 1000, next: (): unknown[] => [{v: 2, w: 3}], applies: true},
        ];
        try {
            for (const {value, rows, next, applies} of cases) {
                inherit(value());
                const previous = {flag: 0, rows: Array.from({length: rows}, () => new Array<unknown>(1))};
                const assigned = {flag: 1, rows: Array.from({length: rows}, next)};
                const budget = {unchanged: new Map<object, object>(), changes: 0};
                expect(scanBranch(previous, assigned, budget))
                    .toBe(legacyScanBranch(previous, assigned, {unchanged: new Map<object, object>()}));
                expect(budget.changes).toBe(countChanges(previous, assigned));
                const left = {flag: 0, rows: Array.from({length: rows}, () => new Array<unknown>(1))};
                const right = {flag: 0, rows: Array.from({length: rows}, () => new Array<unknown>(1))};
                // Applying writes through an inherited object: each run starts from a fresh one.
                const applied = legacyApplyDiff(right, previous, assigned);
                expect(applied).toBe(applies);
                inherit(value());
                expect(applyDiff(left, previous, assigned)).toBe(applied);
                expect(left).toStrictEqual(right);
            }
        } finally {
            if (original) Object.defineProperty(Array.prototype, 0, original);
            else delete (Array.prototype as unknown as Record<number, unknown>)[0];
        }
        expect(Object.prototype.hasOwnProperty.call(Array.prototype, 0)).toBe(original !== undefined);
    });
});

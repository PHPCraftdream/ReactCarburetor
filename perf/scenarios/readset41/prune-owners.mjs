/* oxlint-disable carburetor/require-tsdoc */
// Owner-slice prune: completing a deep read set costs one owner slice per path instead of a
// prefix set over every ancestor of every path. Args: [rows=1000] [completions=8]
import {emit, loadPath} from '../../harness/lib.mjs';
const {completeReads} = await loadPath('Carburetor/Store/Tracking/Observation/completeReads.mjs');

const rows = Number(process.argv[2] ?? 1000);
const runs = Number(process.argv[3] ?? 8);
const paths = ['items.~p', 'items.~k'];
for (let index = 0; index < rows; index++) {
    paths.push(`items.r${index}.~p`, `items.r${index}.title`,
        `items.r${index}.owner.~p`, `items.r${index}.owner.name`);
}
const expected = paths.filter(path => !path.endsWith('.~p') || !paths.some(other =>
    other !== path && other.startsWith(path.slice(0, -2))));

// Wide sibling markers force the exact-scan fallback; only correctness is pinned there.
const widePaths = ['b0.~p', 'b0.x'];
for (let index = 1; index < 40; index++) widePaths.push('b' + index + '.~p');
const wideExpected = widePaths.filter(path => !path.endsWith('.~p') || !widePaths.some(other =>
    other !== path && other.startsWith(path.slice(0, -2))));

const NativeSet = globalThis.Set;
const rawSlice = String.prototype.slice;
const rawStartsWith = String.prototype.startsWith;
let sets = 0;
let slices = 0;
let startsWithCalls = 0;
let correct = true;

const count = (batch, expectation) => {
    sets = 0;
    slices = 0;
    startsWithCalls = 0;
    globalThis.Set = class extends NativeSet {
        constructor(...args) { super(...args); sets++; }
    };
    String.prototype.slice = function (...args) { slices++; return rawSlice.apply(this, args); };
    String.prototype.startsWith = function (...args) {
        startsWithCalls++;
        return rawStartsWith.apply(this, args);
    };
    try {
        for (let run = 0; run < runs; run++) {
            const reads = new NativeSet(batch);
            completeReads(reads);
            correct &&= reads.size === expectation.length && expectation.every(path => reads.has(path));
        }
    } finally {
        globalThis.Set = NativeSet;
        String.prototype.slice = rawSlice;
        String.prototype.startsWith = rawStartsWith;
    }
};

// Warm-up completion is uncounted; the counted window holds only steady-state commit work.
completeReads(new NativeSet(paths));
count(paths, expected);
const depthSlices = slices / runs;
const depthSets = sets / runs;
count(widePaths, wideExpected);
const wideCorrect = correct;
const wideSlices = slices / runs;

const small = ['user.~p', 'user.name'];
count(small, ['user.name']);
const smallSlices = slices / runs;
const smallSets = sets / runs;

// Many childless sibling markers: once the shared scan budget is spent, the prefix set must
// answer the rest, so the comparison count stays linear in the number of paths.
const siblings = Array.from({length: 4000}, (_, index) => `empty${index}.~p`);
count(siblings, siblings);
const siblingStartsWith = startsWithCalls / runs;
const siblingCorrect = correct;

emit({
    depthSlices, depthSets, wideSlices, smallSlices, smallSets,
    siblingStartsWith, siblingCorrect,
    paths: paths.length, wideCorrect, correct,
});

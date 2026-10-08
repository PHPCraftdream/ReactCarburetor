/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
const selections = ['watch', 'hook', 'class'].flatMap(route => [1000, 10000].map(size => ({
    id: `writelog39/interleaved-${route}@${size}`, improvement: 'R39-01',
    scenario: 'writelog39/interleaved', args: [size, route],
    gates: [
        {metric: 'maxReads', max: 4}, {metric: 'initialReads', min: size},
        {metric: 'aliasReads', min: size}, {metric: 'aliasCorrect', equals: true},
        {metric: 'overflowReads', min: size}, {metric: 'recoveryReads', max: 4},
        {metric: 'interleavedRecoveryReads', max: 4}, {metric: 'overflowCorrect', equals: true},
        {metric: 'renders', equals: 3}, {metric: 'text', equals: `K64:${size}`}, {metric: 'done', equals: true},
        ...(size === 10000 ? [{metric: 'maxReads', scale: {from: `writelog39/interleaved-${route}@1000`}, max: 1.1}] : []),
    ],
})));
// Related write after two unrelated publications, 10k rows: now ~0.06-0.19 ms, before ~200 ms.
const boundWrites = ['watch', 'hook', 'class'].map(route => ({
    id: `writelog39/bound-write-${route}@10000`, improvement: 'R39-01',
    scenario: 'writelog39/bound-write', args: [10000, route],
    gates: [
        {metric: 'relatedWriteMs', max: 10}, {metric: 'renders', equals: 21},
        {metric: 'text', equals: 'K21:10000'}, {metric: 'done', equals: true},
    ],
}));
export default [...selections, ...boundWrites, {
    // Heap bytes per write in a 64 MB semi-space child; a fresh store per measurement. `offBytes` (no consumer): 732
    // now, 1082 on pre-R39 (no toggle, proofs always recorded). `savedBytes` = proofs-on minus proofs-off: about 0 now.
    id: 'writelog39/write-bytes@6000', improvement: 'R39-04', scenario: 'writelog39/write-bytes', args: [6000],
    gates: [
        {metric: 'toggleAvailable', equals: true}, {metric: 'savedBytes', max: 60},
        {metric: 'monotone', equals: true}, {metric: 'refBytes', min: 32}, {metric: 'offBytes', min: 100}, {metric: 'offBytes', max: 900},
        {metric: 'newSpaceMB', min: 8}, {metric: 'consumerBytes', over: 'offBytes', max: 10},
        {metric: 'consumerOk', equals: true}, {metric: 'done', equals: true},
    ],
}, {
    // Raw targets of 10000 add/write/remove rows: at most the 2048-pair proof stays reachable.
    id: 'writelog39/raw-retention@10000', improvement: 'control', scenario: 'writelog39/raw-retention', args: [10000],
    gates: [
        {metric: 'survivors', max: 2112}, {metric: 'trackedPairs', max: 2048},
        {metric: 'storeHeldSurvivors', equals: 50}, {metric: 'plainHeldSurvivors', equals: 50},
        {metric: 'freeSurvivors', max: 8}, {metric: 'refCount', equals: 10000}, {metric: 'done', equals: true},
    ],
}, {
    id: 'writelog39/write-allocs@1000', improvement: 'R39-04', scenario: 'writelog39/write-allocs', args: [],
    gates: [
        {metric: 'maps', max: 3}, {metric: 'sets', max: 2000}, {metric: 'sets', min: 1000},
        {metric: 'consumerMaps', min: 1000}, {metric: 'consumerSets', min: 2000},
        {metric: 'wakes', equals: 1001}, {metric: 'done', equals: true},
    ],
}, ...[0, 4000].map(oldPaths => ({
    id: `writelog39/paths-since@${oldPaths}`, improvement: oldPaths === 0 ? 'control' : 'R39-01',
    scenario: 'writelog39/paths-since', args: [oldPaths],
    gates: [
        {metric: 'recentVisits', max: 2}, {metric: 'controlVisits', min: oldPaths + 1},
        {metric: 'returned', equals: 1}, {metric: 'done', equals: true},
        ...(oldPaths === 4000 ? [{metric: 'recentVisits', scale: {from: 'writelog39/paths-since@0'}, max: 2}] : []),
    ],
}))];

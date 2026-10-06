/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Reads. The mechanism gates are counters: one registry insert per fresh proxy is the pre-R30-02
// cost (probeControl proves the insert probe still sees), one source.read() call per recompute or
// watch fire is a rebuilt read tree — the pre-R30-05 cost, whose complement the rows-view
// identity counter pins — and a missing path record for an inherited key is the pre-R12-E02
// behavior (the wake never fires). Each gate fails on that build.
export default [
    {
        id: 'reads/fresh-walk@4k', improvement: 'R30-02', scenario: 'reads/fresh-walk', args: [4000],
        gates: [
            {metric: 'registryInserts', equals: 0}, {metric: 'probeControl', equals: 4},
            {metric: 'walkSum', equals: 7998000},
        ],
    },
    {
        id: 'reads/fresh-walk@16k', improvement: 'R30-02', scenario: 'reads/fresh-walk', args: [16000],
        gates: [
            {metric: 'registryInserts', equals: 0}, {metric: 'probeControl', equals: 4},
            {metric: 'walkSum', equals: 127992000},
        ],
    },
    {
        id: 'reads/persistent-tree@4k', improvement: 'R30-05', scenario: 'reads/persistent-tree', args: [4000, 12],
        gates: [
            {metric: 'recomputeReadTrees', equals: 0}, {metric: 'watchReadTrees', equals: 0},
            {metric: 'identityKept', equals: 12},
            {metric: 'fired', equals: 12}, {metric: 'checksumOk', equals: true},
        ],
    },
    {
        id: 'reads/inherited@2k', improvement: 'R12-E02', scenario: 'reads/inherited', args: [20000, 2000],
        gates: [
            {metric: 'inheritedRecords', equals: 1}, {metric: 'shadowWake', equals: 1},
            {metric: 'shadowValue', equals: '7'}, {metric: 'methodIdentity', equals: true},
            {metric: 'methodsRecorded', equals: 0}, {metric: 'ownLeafRecords', equals: 2},
            {metric: 'indexRecords', equals: 3}, {metric: 'constructRecords', equals: 2000},
            {metric: 'leafSum', equals: 1999000},
        ],
    },
];

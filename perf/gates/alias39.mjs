/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
const leafEntries = ['Date', 'flat'].map(kind => ({
    id: `alias39/${kind === 'Date' ? 'date' : 'flat-instance'}@10k`,
    improvement: 'R39-03', scenario: 'alias39/date-leaves', args: [10000, kind],
    gates: [
        {metric: 'setsPerReadAll', equals: 0},
        {metric: 'ownKeysPerReadAll', equals: 0},
        {metric: 'controlSets', equals: 1},
        {metric: 'controlOwnKeys', equals: 1},
        {metric: 'controlDescriptors', equals: 1},
        {metric: 'controlPropertyNames', equals: 1},
        {metric: 'controlPropertySymbols', equals: 1},
        {metric: 'controlKeyArrays', equals: 3},
        {metric: 'controlKeys', equals: 4},
        {metric: 'mapAliasFound', equals: true},
        {metric: 'mapWakes', equals: 2},
        {metric: 'mapSets', min: 2},
        {metric: 'mapOwnKeys', min: 1},
        {metric: 'childAliasFound', equals: true},
        {metric: 'childWakes', equals: 2},
        {metric: 'childSets', min: 2},
        {metric: 'childOwnKeys', min: 1},
        {metric: 'rootFound', equals: true},
        {metric: 'rootWakes', equals: 1},
        {metric: 'done', equals: true},
    ],
}));

const instanceEntries = [1000, 10000, 50000].map(size => ({
    id: `alias39/instance-leaf@${size / 1000}k`,
    improvement: 'R39-03', scenario: 'alias39/instance-leaf', args: [size],
    gates: [
        {metric: 'descriptorsPerRead', equals: 3},
        {metric: 'descriptorsPerRead', max: 8},
        ...(size === 1000 ? [] : [
            {metric: 'descriptorsPerRead', scale: {from: 'alias39/instance-leaf@1k'}, max: 1},
        ]),
        {metric: 'expectedDescriptors', equals: 3},
        {metric: 'baselineDescriptorsApprox', equals: 3 * size + 7},
        {metric: 'controlDescriptors', equals: 1},
        {metric: 'controlDescriptors', min: 1},
        {metric: 'controlCorrect', equals: true},
        {metric: 'descriptorsRestored', equals: true},
        {metric: 'firstValue', equals: 42},
        {metric: 'topologyValue', equals: 42},
        {metric: 'checksum', equals: 1848},
        {metric: 'aliasBefore', equals: true},
        {metric: 'aliasAdded', equals: true},
        {metric: 'aliasDeleted', equals: true},
        {metric: 'aliasWakes', equals: 4},
        {metric: 'aliasValues', equals: '2,3,4,5'},
        {metric: 'finalValue', equals: 5},
        {metric: 'aliasCorrect', equals: true},
        {metric: 'done', equals: true},
    ],
}));

// Shares the instance-leaf@50k samples: one dayjs-like leaf read after a topology write,
// median of 21 reads: ~0.008 ms now, ~61.7 ms before.
const timeEntry = {
    id: 'alias39/instance-leaf-time@50k', improvement: 'R39-03',
    scenario: 'alias39/instance-leaf', args: [50000],
    gates: [{metric: 'topologyMs', max: 5}, {metric: 'done', equals: true}],
};

// `rows.length = n` drops the owner path; the answer equals a freshly built index.
const truncateEntry = {
    id: 'alias39/truncate-invalidates@64', improvement: 'R39-03',
    scenario: 'alias39/truncate-invalidates', args: [64],
    gates: [
        {metric: 'initialOwners', equals: 'rows.63'}, {metric: 'initialMatches', equals: true},
        {metric: 'truncatedOwners', equals: ''}, {metric: 'truncatedMatches', equals: true},
        {metric: 'aliasedOwners', equals: 'alias'}, {metric: 'aliasedMatches', equals: true},
        {metric: 'staleWakes', equals: 0}, {metric: 'aliasedPushWakes', equals: 0},
        {metric: 'readerPushWakes', equals: 0}, {metric: 'readerValues', equals: '7'},
        {metric: 'lateValues', equals: '7'}, {metric: 'done', equals: true},
    ],
};

export default [...leafEntries, ...instanceEntries, timeEntry, truncateEntry];


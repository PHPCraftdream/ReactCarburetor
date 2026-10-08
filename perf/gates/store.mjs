/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Restore is guarded by exact changed-row wrapping, not its timing relative to snapshot cloning.
// Both timings remain report metrics. R32-08's Object.create counter has its own positive control.
export default [
    {
        id: 'store/restore-one-leaf@1k', improvement: 'R34-04', scenario: 'store/restore-one-leaf', args: [1000, 9],
        gates: [
            {metric: 'restoreRowWraps', equals: 1}, {metric: 'readRowWraps', equals: 1},
            {metric: 'wakes', equals: 9},
            {metric: 'done', equals: true},
        ],
    },
    {
        id: 'store/restore-one-leaf@10k', improvement: 'R34-04', scenario: 'store/restore-one-leaf', args: [10000, 9],
        gates: [
            {metric: 'restoreRowWraps', equals: 1}, {metric: 'readRowWraps', equals: 1},
            {metric: 'wakes', equals: 9},
            {metric: 'done', equals: true},
        ],
    },
    {
        id: 'store/dehydrate@10k', improvement: 'R34-05', scenario: 'store/dehydrate', args: [10000, 15],
        gates: [
            // Real d300b9a44c84 stringify yields {"instances":{}} with 0 snapshots, not the wire payload.
            // No comparable >=1 -> 0 mechanism exists here; keep the original timing gate.
            {metric: 'scopeSnapshots', equals: 0},
            {metric: 'scopeStringifyMs', over: 'dehydrateStringifyMs', max: 0.8},
            {metric: 'samePayload', equals: true},
        ],
    },
    {
        id: 'store/r32-deep-clone@10k', improvement: 'R32-08', scenario: 'store/r32-deep-clone',
        args: [10000, 31],
        gates: [
            {metric: 'snapshotObjectCreates', equals: 0}, {metric: 'probeControlCreates', equals: 1},
            {metric: 'copied', equals: true},
        ],
    },
    {
        id: 'store/r33-persist@10k', improvement: 'R33-07', scenario: 'store/r33-persist',
        args: [10000, 50],
        gates: [
            {metric: 'setItemCallsDefault', equals: 1}, {metric: 'setItemCallsNoCoalesce', equals: 50},
            {metric: 'defaultMs', over: 'noCoalesceMs', max: 0.5},
            {metric: 'defaultContentOk', equals: true}, {metric: 'noCoalesceContentOk', equals: true},
        ],
    },
    // PG-B1
    // Candidate scopeSnapshots 0; dehydrate/explicit synthetic negative 1; empty 0.
    // d300b9a44c84 has no scope.toJSON: scopeSnapshots is 0, scopeStringifyMs is null; no mechanism separation.
    {
        id: 'store/dehydrate@10k-controls', improvement: 'control', scenario: 'store/dehydrate', args: [10000, 15],
        gates: [
            {metric: 'dehydrateSnapshots', min: 1}, {metric: 'negativeSnapshots', min: 1},
            {metric: 'emptySnapshots', equals: 0}, {metric: 'counterPayloadsEqual', equals: true},
        ],
    },
    // R6-02 fix 65b7b0549769, parent 171c1fa781f3: cloneOwnKeys 10000 -> 0.
    {
        id: 'store/r32-deep-clone@10k-ownkeys', improvement: 'R6-02', scenario: 'store/r32-deep-clone', args: [10000, 31],
        gates: [{metric: 'cloneOwnKeys', equals: 0}, {metric: 'cloneCopied', equals: true}],
    },
    // JS-R13-07 fix f19f6f074877, parent 5fd73a1e30ae: cloneDefineProperties 20000 -> 0.
    {
        id: 'store/r32-deep-clone@10k-define', improvement: 'JS-R13-07', scenario: 'store/r32-deep-clone', args: [10000, 31],
        gates: [{metric: 'cloneDefineProperties', equals: 0}, {metric: 'cloneCopied', equals: true}],
    },
    {
        id: 'store/r32-deep-clone@10k-controls', improvement: 'control', scenario: 'store/r32-deep-clone', args: [10000, 31],
        gates: [
            {metric: 'emptyOwnKeys', equals: 0}, {metric: 'emptyDefineProperties', equals: 0},
            {metric: 'ownKeysControl', equals: 1}, {metric: 'protoDefineControl', min: 1},
            {metric: 'protoCopied', equals: true},
        ],
    },
    // PG-RESID
    // R34-05: real scope stringify snapshots are 0 on both builds; this is a probe control, not separation.
    // d300b9a44c84 has a registered store in instances; JSON.stringify(Map) hides its entries as {}.
    // The resulting {"instances":{}} is 16 bytes, not an empty Map or a synthetic historical toJSON.
];

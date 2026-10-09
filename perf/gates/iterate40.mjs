export default [
    ...['map', 'filter', 'forEach'].map(method => ({
        id: `iterate40/traps-${method}@5000`, improvement: 'R40-03', scenario: 'iterate40/traps', args: [method],
        gates: [
            {metric: 'gets', equals: 5000}, {metric: 'has', equals: 0}, {metric: 'trapsPerElement', equals: 1},
            {metric: 'nativeGets', equals: 5000}, {metric: 'nativeHas', equals: 5000},
            {metric: 'nativeTrapsPerElement', equals: 2},
            {metric: 'manualGets', equals: 5000}, {metric: 'manualHas', equals: 0},
            {metric: 'checksum', equals: 215006}, {metric: 'manualChecksum', equals: 215006},
            {metric: 'readCount', equals: 5002}, {metric: 'nativeReadCount', equals: 5002},
            {metric: 'exactReads', equals: true}, {metric: 'correct', equals: true},
        ],
    })),
    {id: 'iterate40/parent-render@5000', improvement: 'R40-03', scenario: 'iterate40/parent-render', gates: [
        {metric: 'gets', equals: 5000}, {metric: 'has', equals: 0},
        {metric: 'parentGets', equals: 5000}, {metric: 'parentHas', equals: 0},
        {metric: 'nativeGets', equals: 5000}, {metric: 'nativeHas', equals: 5000},
        {metric: 'appendGets', equals: 5001}, {metric: 'appendHas', equals: 0},
        {metric: 'nativeAppendGets', equals: 5001}, {metric: 'nativeAppendHas', equals: 5001},
        {metric: 'readCount', equals: 5002}, {metric: 'appendReadCount', equals: 5003},
        {metric: 'appendRenders', equals: 1}, {metric: 'nativeAppendRenders', equals: 1},
        {metric: 'exactReads', equals: true}, {metric: 'timingCorrect', equals: true},
        {metric: 'correct', equals: true},
    ]},
    {id: 'iterate40/computed-filter@1000', improvement: 'R40-03', scenario: 'iterate40/computed-filter', gates: [
        {metric: 'gets', equals: 1000}, {metric: 'has', equals: 0},
        {metric: 'nativeGets', equals: 1000}, {metric: 'nativeHas', equals: 1000},
        {metric: 'readCount', equals: 2336}, {metric: 'nativeReadCount', equals: 2336},
        {metric: 'deliveries', equals: 4}, {metric: 'nativeDeliveries', equals: 4},
        {metric: 'exactReads', equals: true}, {metric: 'correct', equals: true},
    ]},
    {id: 'iterate40/delivery-index-length', improvement: 'control', scenario: 'iterate40/delivery', gates: [
        {metric: 'classChanges', equals: 3}, {metric: 'hookChanges', equals: 3}, {metric: 'correct', equals: true},
    ]},
    {id: 'iterate40/own-reads', improvement: 'control', scenario: 'iterate40/own-reads', gates: [
        {metric: 'ownTableProbes', equals: 0}, {metric: 'probeControl', equals: 1000},
        {metric: 'objectLeafChecksum', equals: 17_000_000}, {metric: 'arrayIndexChecksum', equals: 17_000_000},
        {metric: 'probeLeafChecksum', equals: 17_000}, {metric: 'probeIndexChecksum', equals: 17_000},
        {metric: 'exactReads', equals: true}, {metric: 'correct', equals: true},
    ]},
];
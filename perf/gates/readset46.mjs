// PERF round 46: a render attempt matches its reads against the slot's last committed raw
// recording, so a stable list re-render adopts the filed set: no Set, no slice, no subscribe.
export default [
    {
        id: 'readset46/stable-commit@1000', area: 'readset46', improvement: 'R46-02',
        scenario: 'readset46/stable-commit', args: [1000, 5],
        gates: [
            {metric: 'trackSets', equals: 0}, {metric: 'trackSlices', equals: 0},
            {metric: 'trackSubscribes', equals: 0}, {metric: 'trackRefiles', equals: 0},
            {metric: 'connectSets', equals: 0}, {metric: 'connectSlices', equals: 0},
            {metric: 'connectSubscribes', equals: 0}, {metric: 'connectRefiles', equals: 0},
            // Positive control: a branch switch still builds the new set and re-files it once per mode.
            {metric: 'switchSets', min: 1}, {metric: 'switchSubscribes', equals: 2},
            {metric: 'switchRefiles', equals: 2},
            {metric: 'rows', equals: 1000}, {metric: 'correct', equals: true},
        ],
    },
];

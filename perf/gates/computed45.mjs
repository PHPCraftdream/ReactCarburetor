// PERF round 45: track() reuses the slot's recorder and encoded id, while every write still
// recomputes once, delivers once, keeps the exact final value and stays silent on unrelated
// stores — recorder reuse must never cost a missed subscription.
export default [
    {
        id: 'computed45/track-recorders@200', improvement: 'R45-05',
        scenario: 'computed45/track-recorders', args: [200, 40],
        gates: [
            {metric: 'recorders', max: 3},
            {metric: 'bodyRuns', equals: 41},
            {metric: 'notified', equals: 40},
            {metric: 'irrelevantBodyRuns', equals: 0},
            {metric: 'irrelevantNotified', equals: 0},
            {metric: 'finalValue', equals: 7900},
            {metric: 'deliveryExact', equals: true},
            {metric: 'done', equals: true},
        ],
    },
];

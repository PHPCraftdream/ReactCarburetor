/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Components. Render counts, rendered text and the instance/proxy shapes are exact; mount cost
// is bounded by the 4k/1k size scale; SSR timings are diagnostic only.
// mount-edit is a correctness control (the old benchmark was a non-regression A/B).
export default [
    {
        id: 'components/mount-edit@1k', improvement: 'control', scenario: 'components/mount-edit', args: [1000, 5],
        gates: [
            {metric: 'rowRendersPerEdit', equals: 1}, {metric: 'pageRendersPerReplace', equals: 1},
            {metric: 'text', equals: 'edited-4|1000'},
        ],
    },
    {
        id: 'components/mount-edit@4k', improvement: 'control', scenario: 'components/mount-edit', args: [4000, 5],
        gates: [
            {metric: 'rowRendersPerEdit', equals: 1}, {metric: 'pageRendersPerReplace', equals: 1},
            {metric: 'mountMs', scale: {from: 'components/mount-edit@1k'}, max: 18},
            {metric: 'text', equals: 'edited-4|4000'},
        ],
    },
    {
        id: 'components/ssr@4k', improvement: 'JS-R13-06', scenario: 'components/ssr', args: [4000, 3],
        gates: [
            {metric: 'instanceMethodFields', equals: 0},
            {metric: 'hasLastRow', equals: true}, {metric: 'htmlChars', min: 60000},
        ],
    },
    {
        id: 'components/proxy-reads', improvement: 'JS-R13-10', scenario: 'components/proxy-reads', args: [200],
        gates: [
            {metric: 'steadyRenders', equals: 200},
            {metric: 'steadyReadCalls', equals: 0}, {metric: 'steadyViews', equals: 0},
            {metric: 'changedRenders', equals: 1}, {metric: 'changedReadCalls', equals: 1},
            {metric: 'unreadRenders', equals: 0},
            {metric: 'text', equals: '7'}, {metric: 'sinkPositive', equals: true},
        ],
    },
    {
        // R37-06: equal branch switch migrates read ownership at notification time —
        // no owner render, hook control parity, real value change still renders.
        id: 'components/branch-migration@1', improvement: 'R37-06', scenario: 'components/branch-migration', args: [1],
        gates: [
            {metric: 'classAfterEqualSwitch', equals: 1},
            {metric: 'hookAfterEqualSwitch', equals: 1},
            {metric: 'classAfterRealChange', min: 2},
            {metric: 'oldBranchSilent', equals: true},
            {metric: 'text', equals: '3'},
            {metric: 'done', equals: true},
        ],
    },
    // PG-HARNESS
    {
        // JS-R14-05: second instance false on the parent, true on current V8.
        id: 'components/fast-properties@2', improvement: 'JS-R14-05',
        scenario: 'components/pg/harness/fast-properties', args: [], nodeArgs: ['--allow-natives-syntax'],
        gates: [{metric: 'secondFast', equals: true}],
    },
    {
        id: 'components/fast-properties@2-controls', improvement: 'control',
        scenario: 'components/pg/harness/fast-properties', args: [], nodeArgs: ['--allow-natives-syntax'],
        gates: [
            {metric: 'plainFast', equals: true}, {metric: 'dictionaryFast', equals: false},
            {metric: 'done', equals: true},
        ],
    },
    // PG-C2
    {
        // e52def010a10 -> current (3 samples): mount 8000 -> 4000; relevant 1 -> 1, writes 1 -> 1, done true.
        id: 'components/mount-sibling-writer@4k', improvement: 'JS-R16-05',
        scenario: 'components/pg/c2/mount-sibling-writer', args: [4000],
        gates: [
            {metric: 'mountRowRenders', equals: 4000}, {metric: 'relevantRowRenders', equals: 1},
            {metric: 'writes', equals: 1}, {metric: 'done', equals: true},
        ],
    },
    {
        // 25e3dcc45fca -> current (3 samples): edit parent 1 -> 0, row 1 -> 1; key-add parent/row 1 -> 1, done true.
        id: 'components/keys-parent@4k', improvement: 'JS-R16-01',
        scenario: 'components/pg/c2/keys-parent', args: [4000],
        gates: [
            {metric: 'editParentRenders', equals: 0}, {metric: 'editRowRenders', equals: 1},
            {metric: 'relevantParentRenders', equals: 1}, {metric: 'newRowRenders', equals: 1},
            {metric: 'done', equals: true},
        ],
    },
    {
        // c793167d0a48 -> current (3 samples): map parent 1 -> 0, row 1 -> 1; push rows 1001 -> 1.
        // Replace/splice parent 1 -> 0, rows 1000 -> 1; for-of 1 -> 0; all relevant controls 1 -> 1, done true.
        id: 'components/list-precision@1k', improvement: 'JS-R14-02+JS-R14-03+JS-R14-04',
        scenario: 'components/pg/c2/list-precision', args: [1000],
        gates: [
            {metric: 'mapParentRenders', equals: 0}, {metric: 'mapRowRenders', equals: 1},
            {metric: 'pushParentRenders', equals: 1}, {metric: 'pushRowRenders', equals: 1},
            {metric: 'replaceParentRenders', equals: 0}, {metric: 'replaceRowRenders', equals: 1},
            {metric: 'spliceParentRenders', equals: 0}, {metric: 'spliceRowRenders', equals: 1},
            {metric: 'forOfParentRenders', equals: 0}, {metric: 'forOfRowRenders', equals: 0},
            ...['map', 'push', 'replace', 'splice', 'forOf'].map(mode => ({metric: mode + 'RelevantRenders', equals: 1})),
            {metric: 'done', equals: true},
        ],
    },
    {
        // d006c59494d5 -> current (3 samples): concat/toString/String unrelated 1 -> 0; relevant 1 -> 1, done true.
        id: 'components/symbol-reads@1', improvement: 'JS-R15-01',
        scenario: 'components/pg/c2/symbol-reads', args: [1],
        gates: [
            ...['concat', 'toString', 'string'].flatMap(mode => [
                {metric: mode + 'UnrelatedRenders', equals: 0}, {metric: mode + 'RelevantRenders', equals: 1},
            ]),
            {metric: 'done', equals: true},
        ],
    },
    // PG-D1
    // worktrees/bench-dist/bf6af47e7990: 2437 -> ~2 KB/10k comparisons, key copies 20000 -> 0.
    {
        id: 'components/props-gate@10k', improvement: 'R36-07', scenario: 'components/pg/d1/props-gate', args: [],
        gates: [{metric: 'allocatedKB', max: 16}, {metric: 'keyCopies', equals: 0},
            {metric: 'monotone', equals: true}, {metric: 'done', equals: true}],
    },
    {
        id: 'components/props-gate@10k-control', improvement: 'control', scenario: 'components/pg/d1/props-gate', args: [],
        gates: [{metric: 'copyingKB', min: 1000}, {metric: 'controlKeyCopies', equals: 20000},
            {metric: 'monotone', equals: true}, {metric: 'done', equals: true}],
    },
    // worktrees/bench-dist/a6be80b0d25e: retained connected/plain 1.67 -> 1.55. Ratio alone passes both;
    // actual facade trap closures (40000 -> 0) are the deterministic regression verdict.
    {
        id: 'components/connect-retention@4k', improvement: 'JS-R15-06', scenario: 'components/pg/d1/connect-retention', args: [],
        gates: [{metric: 'connectedBytes', over: 'plainBytes', max: 1.9},
            {metric: 'connectedOwnTraps', equals: 0}, {metric: 'connectedProxies', min: 8000},
            {metric: 'done', equals: true}],
    },
    {
        id: 'components/connect-retention@4k-control', improvement: 'control', scenario: 'components/pg/d1/connect-retention', args: [],
        gates: [{metric: 'plainBytes', min: 1000}, {metric: 'idleProxies', equals: 0},
            {metric: 'controlProxies', equals: 4}, {metric: 'controlOwnTraps', equals: 8}, {metric: 'done', equals: true}],
    },
    // PG-B1
    {
        id: 'components/ssr-count@1k', improvement: 'control', scenario: 'components/ssr', args: [1000, 3],
        gates: [
            {metric: 'emptyCalls', equals: 0}, {metric: 'positiveCalls', equals: 4},
            {metric: 'positiveSizeReads', equals: 1}, {metric: 'countedHtmlCorrect', equals: true},
        ],
    },
    {
        id: 'components/ssr-count@4k', improvement: 'JS-R13-02', scenario: 'components/ssr', args: [4000, 3],
        gates: [
            {metric: 'mapWeakCallsPerRow', scale: {from: 'components/ssr-count@1k'}, max: 1.2},
            {metric: 'emptyCalls', equals: 0}, {metric: 'positiveCalls', equals: 4},
            {metric: 'positiveSizeReads', equals: 1}, {metric: 'countedHtmlCorrect', equals: true},
        ],
    },
    // PG-RESID
    // 759c94d8aa71 -> current (4000 rows, production): live-view notes during the render 12000 -> 0.
    // The build bakes the development flag off, so a direct note() call is the seam control.
    {
        id: 'components/live-view-notes@4k', improvement: 'JS-R13-05',
        scenario: 'components/pg/resid/live-view-notes', args: [4000],
        gates: [{metric: 'renderNotes', equals: 0}, {metric: 'rowsRendered', equals: 4000}, {metric: 'done', equals: true}],
    },
    {
        id: 'components/live-view-notes@4k-control', improvement: 'control',
        scenario: 'components/pg/resid/live-view-notes', args: [4000],
        gates: [{metric: 'noteIsFunction', equals: true}, {metric: 'seamNotes', equals: 1}],
    },
]

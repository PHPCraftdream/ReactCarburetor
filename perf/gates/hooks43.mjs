export default ['18', '19'].flatMap(version => ['plain', 'gap'].map(mode => ({
    id: `hooks43/store-ssr-commit-boundary@react${version}-${mode}`, improvement: 'R43-A02',
    scenario: 'hooks43/store-ssr-commit-boundary', args: [version, mode],
    // The scenario takes React from a `.consumer-matrix` cell for the non-root major; React 19 is the root.
    requires: version === '18' ? [{path: '.consumer-matrix/react18-npm'}] : undefined,
    gates: [{metric: 'graphWarnings', equals: 0}, {metric: 'proofChecks', min: 12},
        {metric: 'layoutAcquires', equals: 2}, {metric: 'layoutReconciliations', equals: 1},
        {metric: 'passiveProofRejected', equals: 1},
        {metric: 'storeWarnings', equals: 0}, {metric: 'serverAdds', equals: 0},
        {metric: 'hydrationRecovery', equals: 0}, {metric: 'releasedOwners', equals: 0},
        {metric: 'equalMigration', equals: 1}, {metric: 'gap', equals: Number(mode === 'gap')},
        version === '18' ? {metric: 'positiveWarnings', min: 1} : {metric: 'positiveWarnings', equals: 0}],
})));

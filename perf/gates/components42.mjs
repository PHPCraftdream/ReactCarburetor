export default [{
    id: 'components42/selection-commit-ownership', improvement: 'R42-A01',
    scenario: 'components42/selection-commit-ownership', args: [],
    gates: [
        {metric: 'restoredDeliveries', equals: 64},
        {metric: 'releasedOwners', equals: 0},
        {metric: 'equalOwnerRenders', equals: 0},
        {metric: 'equalChildRenders', equals: 0},
        {metric: 'warmChildRenders', equals: 0},
        {metric: 'hookWarmSelectorCalls', equals: 0},
        {metric: 'warmRegistrationAdds', equals: 0},
        {metric: 'warmRegistrationRemoves', equals: 0},
        {metric: 'registrationBalance', equals: 0},
    ],
}];

import {emit, load, setupReact} from '../../harness/lib.mjs';
import {checkOwnership, checkCommittedControl, checkWriteGap} from './checks.mjs';
process.env.NODE_ENV = 'development';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const {React} = await setupReact();
const {createRoot} = await import('react-dom/client');
const env = {React, createRoot, api: await load(), interop: await load('Interop')};
let restoredDeliveries = 0, releasedOwners = 0, registrationBalance = 0;
let equalOwnerRenders = 0, equalChildRenders = 0, warmChildRenders = 0;
let hookWarmSelectorCalls = 0, warmRegistrationAdds = 0, warmRegistrationRemoves = 0;
for (const self of [true, false]) {
    for (const strict of [true, false]) {
        for (const stateful of [true, false]) {
            for (const resume of [true, false]) {
                for (const swap of [true, false]) {
                    const result = await checkOwnership(env, {self, strict, stateful, resume, swap});
                    restoredDeliveries += result.restoredDeliveries;
                    releasedOwners += result.releasedOwners;
                    registrationBalance += result.registrationBalance;
                }
            }
        }
    }
}
for (const kind of ['raw', 'hook']) {
    const result = await checkOwnership(env, {kind, self: false, resume: true});
    // Delivery gate above intentionally covers the 32 selected-owner matrix lanes.
    releasedOwners += result.releasedOwners;
    registrationBalance += result.registrationBalance;
}
for (const kind of ['selected', 'hook']) {
    const result = await checkCommittedControl(env, kind);
    equalOwnerRenders += result.equalOwnerRenders;
    equalChildRenders += result.equalChildRenders;
    warmChildRenders += result.warmChildRenders;
    if (kind === 'hook') hookWarmSelectorCalls += result.warmSelectorCalls;
    warmRegistrationAdds += result.warmRegistrationAdds;
    warmRegistrationRemoves += result.warmRegistrationRemoves;
    releasedOwners += result.releasedOwners;
    registrationBalance += result.registrationBalance;
}
await checkWriteGap(env);
emit({restoredDeliveries, releasedOwners, equalOwnerRenders, equalChildRenders, warmChildRenders,
    hookWarmSelectorCalls, warmRegistrationAdds, warmRegistrationRemoves, registrationBalance});

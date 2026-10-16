import {emit, load, setupReact} from '../../harness/lib.mjs';
const globalRejections = [];
const observe = reason => globalRejections.push(reason);
process.on('unhandledRejection', observe);
import {checkPreloaderDisarm} from './boundaries.mjs';
import {checkMultiEntry} from './multi-entry.mjs';
import {checkRemoval, checkDisarm, checkRefresh, checkWarm} from './checks.mjs';
process.env.NODE_ENV = 'development';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const {React} = await setupReact();
const {createRoot} = await import('react-dom/client');
const env = {React, createRoot, api: await load(), interop: await load('Interop')};
let restoredLoading = 0, readyDOM = 0;
for (const action of ['abort', 'forget', 'restore', 'clear']) {
    for (const phase of ['before', 'after', 'replacement']) {
        for (const strict of [false, true]) {
            const result = await checkRemoval(env, {action, phase, strict});
            restoredLoading += result.restoredLoading;
            readyDOM += result.readyDOM;
        }
    }
}
for (const kind of ['hook', 'class']) for (const mode of ['source', 'args', 'unmount']) {
    for (const strict of [false, true]) await checkDisarm(env, {kind, mode, strict});
}
for (const action of ['abort', 'forget', 'restore', 'clear']) await checkRefresh(env, 'hook', action);
let preloaderRetirements = 0, retiredLoads = 0, registrationBalance = 0, activeRegistrations = 0;
for (const kind of ['hook', 'class']) for (const mode of ['source', 'args', 'unmount']) {
    for (const strict of [false, true]) {
        const result = await checkPreloaderDisarm(env, {kind, mode, strict});
        preloaderRetirements += result.preloaderRetirements;
        retiredLoads += result.retiredLoads;
        registrationBalance += result.registrationBalance;
        activeRegistrations += result.activeRegistrations;
    }
}
// Separate counters: the original R01 restoredLoading/readyDOM totals remain 24.
const multi = {multiColdOwnerRenders: 0, multiColdStarts: 0, multiColdReadyDOM: 0,
    multiRemovals: 0, multiReplacementStarts: 0, multiSecondStarts: 0, multiReadyDOM: 0,
    multiRetiredWinners: 0, multiRegistrationBalance: 0, multiActiveRegistrations: 0};
for (const strict of [false, true]) {
    const cold = await checkMultiEntry(env, {strict});
    for (const [metric, value] of Object.entries(cold)) {
        if (value !== undefined) multi[metric] += value;
    }
    for (const action of ['abort', 'forget', 'restore']) for (const replacement of [false, true]) {
        const result = await checkMultiEntry(env, {action, replacement, strict});
        for (const [metric, value] of Object.entries(result)) multi[metric] += value;
    }
}
const warm = await checkWarm(env);
registrationBalance += warm.registrationBalance;
activeRegistrations += warm.activeRegistrations;
process.removeListener('unhandledRejection', observe);
emit({
    restoredLoading, readyDOM, ...warm, ...multi,
    preloaderRetirements, retiredLoads, registrationBalance, activeRegistrations,
    globalRejections: globalRejections.length,
});

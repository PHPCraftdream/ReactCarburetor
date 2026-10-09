/* oxlint-disable carburetor-internal/require-tsdoc */
import {emit, load} from '../../harness/lib.mjs';
const {Carburetor} = await load();
const names = [
    'data', 'scheduler', 'subscribers', 'subscriptionGeneration', 'subscriberIndex', 'aliases',
    'patchPort', 'patchObservers', 'notifiedVersion', 'subscriptionByReads', 'writes', 'writeTargets',
    'writeLog', 'targetOwners', 'draftTouched', 'pendingEmit', 'unpublishedDraftCheck', 'draftProxy',
    'publicationPending', 'pendingPublication', 'activeInstallation', 'writeRecorder',
    'commitState', 'port', 'retract', 'rememberPublication', 'touchDraft', 'recordWrite',
];
class Store extends Carburetor {
    change(n) { this.update(draft => { draft.n = n; }); }
    later(n) { this.draft.n = n; this.emitSoon(); }
}
let correct = 0;
let controls = 0;
for (const name of names) {
    try {
        const store = new Store({n: 0});
        Object.defineProperty(store, name, {value: 'domain', writable: true, configurable: true});
        const seen = [];
        const id = store.subscribe(() => seen.push(store.getData().n));
        store.change(1);
        store.setData({n: 2});
        store.restore({n: 3});
        store.later(4);
        await Promise.resolve();
        if (seen.join(',') === '1,2,3,4' && store.getData().n === 4 && Reflect.get(store, name) === 'domain') {
            correct++;
        }
        store.unsubscribe(id);
    } catch { /* A baseline collision is a failed verdict, not missing instrumentation. */ }
    const control = new Store({n: 0});
    control.change(1);
    if (control.getData().n === 1 && control.getVersion() === 1) controls++;
}
const ownNames = Object.getOwnPropertyNames(new Carburetor({n: 0})).length;
emit({ownNames, correct, controls, cases: names.length, done: correct === names.length && ownNames === 0});

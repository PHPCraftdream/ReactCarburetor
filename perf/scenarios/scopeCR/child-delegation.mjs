import {load, emit} from '../../harness/lib.mjs';

const {CarburetorScope, carburetorToken} = await load();
class CountingScope extends CarburetorScope {
    calls = 0;
    get(token) {
        this.calls++;
        return super.get(token);
    }
}
let parentFactories = 0;
let localFactories = 0;
const delegated = carburetorToken(() => { parentFactories++; return undefined; }, 'perf/scopeCR/delegated');
const local = carburetorToken(owner => { localFactories++; return {owner}; }, 'perf/scopeCR/local');
const parent = new CountingScope();
const child = parent.child([local]);
const rootCallsBefore = parent.calls;
child.get(local);
child.get(local);
const localRootCalls = parent.calls - rootCallsBefore;
child.get(delegated);
child.get(delegated);
const delegatedParentCalls = parent.calls - rootCallsBefore - localRootCalls;
const parentFactoriesBeforeControl = parentFactories;
const direct = new CountingScope();
for (let index = 0; index < 10; index++) direct.get(delegated);
const positiveControlCalls = direct.calls;
const correct = localRootCalls === 0 && localFactories === 1 && delegatedParentCalls === 1
    && parentFactoriesBeforeControl === 1 && positiveControlCalls === 10;
child.dispose(); parent.dispose(); direct.dispose();
emit({localRootCalls, localFactories, delegatedParentCalls,
    parentFactories: parentFactoriesBeforeControl, positiveControlCalls, correct});

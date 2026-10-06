/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R37-06: an equal-valued conditional branch switch (useLeft true->false, left===right) must
// migrate the class connection's read set at notification time WITHOUT a forceUpdate — the
// hook control stays at 1 render and the class owner must now stay at 1 too. A real value
// change afterwards still renders and updates the DOM, and the old branch goes silent.
// Counters only; no timing gates. Args: [unused=1]
import {emit, load, setupReact} from '../../harness/lib.mjs';

const {AntiHookComponent, Carburetor} = await load();
const {useCarburetorValue} = await load('Interop');
const {React, flushSync, root, container} = await setupReact();

class S extends Carburetor { run(fn) { this.update(fn); } }
const store = new S({useLeft: true, left: 1, right: 1});
const select = data => (data.useLeft ? data.left : data.right);

let classRenders = 0;
let hookRenders = 0;

class Owner extends AntiHookComponent {
    branch = this.connectSelection(() => store, select);

    render() {
        classRenders++;
        return React.createElement('p', null, this.branch());
    }
}

const Hook = () => {
    hookRenders++;
    return React.createElement('p', null, useCarburetorValue(store, select));
};

flushSync(() => root.render(React.createElement(React.Fragment, null,
    React.createElement(Hook), React.createElement(Owner))));
const hookInitial = hookRenders;
const classInitial = classRenders;

// The equal-valued branch switch under test.
flushSync(() => store.run(draft => { draft.useLeft = false; }));
const hookAfterEqualSwitch = hookRenders;
const classAfterEqualSwitch = classRenders;
const textAfterSwitch = container.querySelectorAll('p')[1].textContent;

// The migrated subscription covers exactly the new branch: the old one is silent.
flushSync(() => store.run(draft => { draft.left = 2; }));
const oldBranchSilent = classRenders === classAfterEqualSwitch
    && container.querySelectorAll('p')[1].textContent === textAfterSwitch;

// A real value change on the selected branch must still render and update the DOM.
flushSync(() => store.run(draft => { draft.right = 3; }));
const classAfterRealChange = classRenders;
const text = container.querySelectorAll('p')[1].textContent;

flushSync(() => root.unmount());

emit({
    hookInitial, classInitial,
    hookAfterEqualSwitch, classAfterEqualSwitch,
    classAfterRealChange, oldBranchSilent, text,
    done: hookInitial === 1 && classInitial === 1
        && hookAfterEqualSwitch === 1 && classAfterEqualSwitch === 1
        && classAfterRealChange >= 2 && oldBranchSilent && text === '3',
});

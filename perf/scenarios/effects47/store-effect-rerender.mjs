/* oxlint-disable react/globals, carburetor/require-tsdoc */
// useEffects runs on every render: a useStoreEffect whose store, selector and effect keep their
// identity must not rebuild its effect closure and dependency array, nor reach useEffect again.
// Args: [renders=200]
import {emit, load, setupReact} from '../../harness/lib.mjs';

const {AntiHookComponent, Carburetor} = await load();
const {React, flushSync, root, container} = await setupReact();

const renders = Number(process.argv[2] ?? 200);
const store = new Carburetor({text: 'a'});
const selectText = data => data.text;

let effectRuns = 0;
let useEffectCalls = 0;
let watches = 0;
const watch = store.watch.bind(store);
store.watch = (select, onChange) => {
    watches++;
    return watch(select, onChange);
};

class Draft extends AntiHookComponent {
    useEffect(...args) {
        useEffectCalls++;
        return super.useEffect(...args);
    }

    useEffects() {
        this.useStoreEffect('save', store, selectText, this.save);
    }

    save = text => {
        effectRuns++;
        void text;
    };

    render() {
        return React.createElement('p', {className: 'draft'}, String(this.props.tick));
    }
}

for (let tick = 0; tick < renders; tick++) {
    flushSync(() => root.render(React.createElement(Draft, {tick})));
}
const rendered = container.querySelector('.draft')?.textContent === String(renders - 1);
const quietRuns = effectRuns;

flushSync(() => store.setData({text: 'b'}));
const followed = effectRuns === quietRuns + 1;

flushSync(() => root.unmount());

emit({
    renders, effectRuns: quietRuns, useEffectCalls, watches, followed,
    done: rendered && followed && quietRuns === 1 && watches === 1,
});

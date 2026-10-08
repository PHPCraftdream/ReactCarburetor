/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// JS-R15-01: well-known symbol fixtures from list-render-precision.test.tsx.
import {emit, load, setupReact} from '../../../../harness/lib.mjs';
const {AntiHookComponent, Carburetor} = await load();
const {React, flushSync, root, container} = await setupReact();
const metrics = {};
let done = true;
for (const mode of ['concat', 'toString', 'string']) {
    const store = new Carburetor({tags: ['x', 'y'], user: {name: 'Ann'}, other: 0});
    let renders = 0;
    class Reader extends AntiHookComponent {
        render() {
            renders++;
            const data = this.useCarburetor(store);
            const text = mode === 'concat' ? data.tags.concat(['z']).join(',')
                : mode === 'toString' ? Object.prototype.toString.call(data.user) : String(data.user);
            return React.createElement('span', null, text);
        }
    }
    flushSync(() => root.render(React.createElement(Reader)));
    renders = 0;
    flushSync(() => store.update(draft => {draft.other++;}));
    metrics[mode + 'UnrelatedRenders'] = renders;
    done &&= container.textContent === (mode === 'concat' ? 'x,y,z' : '[object Object]');
    renders = 0;
    flushSync(() => store.update(draft => {
        if (mode === 'concat') draft.tags[0] = 'changed';
        else draft.user = ['changed'];
    }));
    metrics[mode + 'RelevantRenders'] = renders;
    done &&= container.textContent === (mode === 'concat' ? 'changed,y,z'
        : mode === 'toString' ? '[object Array]' : 'changed');
    flushSync(() => root.render(null));
}
flushSync(() => root.unmount());
emit({...metrics, done});

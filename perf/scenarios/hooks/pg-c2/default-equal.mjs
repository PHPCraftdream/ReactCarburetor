/* oxlint-disable react/globals, react/immutability, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// JS-R13-08: wake the title selector via a real dependency write with equal selected content.
import {emit, load, setupReact} from '../../../harness/lib.mjs';
const {Carburetor} = await load();
const {useCarburetorValue} = await load('Interop');
const {React, flushSync, root, container} = await setupReact();
const store = new Carburetor({todo: {title: 'shopping', done: false}});
const renders = Array(100).fill(0);
let calls = 0;
const select = data => {
    calls++;
    void data.todo.done;
    return {title: data.todo.title};
};
function Reader({id}) {
    renders[id]++;
    const value = useCarburetorValue(store, select);
    return React.createElement('span', null, value.title);
}
flushSync(() => root.render(React.createElement('div', null,
    ...renders.map((_, id) => React.createElement(Reader, {key: id, id})))));
const mountOnce = renders.every(value => value === 1);
renders.fill(0);
calls = 0;
flushSync(() => store.update(draft => { draft.todo = {...draft.todo, done: true}; }));
const equalRenders = renders.reduce((sum, value) => sum + value, 0);
const equalCalls = calls;
const equalText = container.textContent;
renders.fill(0);
calls = 0;
flushSync(() => store.update(draft => { draft.todo.title = 'errands'; }));
const changedOnce = renders.every(value => value === 1);
const changedRenders = renders.reduce((sum, value) => sum + value, 0);
const changedCalls = calls;
const done = equalText === 'shopping'.repeat(100) && container.textContent === 'errands'.repeat(100)
    && store.getData().todo.done;
flushSync(() => root.unmount());
emit({mountOnce, equalRenders, equalCalls, changedOnce, changedRenders, changedCalls, done});

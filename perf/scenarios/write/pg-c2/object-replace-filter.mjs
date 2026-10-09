/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// JS-R16-03: a title-only object replacement must not invalidate a done-only filter.
import {emit, load, setupReact, engine} from '../../../harness/lib.mjs';
const {Carburetor, computed, AntiHookComponent} = await load();
const {React, flushSync, root, container} = await setupReact();
const store = new Carburetor({items: Array.from({length: 4000}, (_, id) => ({id, title: `row ${id}`, done: false}))});
let bodies = 0;
let renders = 0;
const open = computed(read => {
    bodies++;
    return read(store).items.filter(item => !item.done).length;
});
class Reader extends AntiHookComponent {
    render() {
        renders++;
        return React.createElement('span', null, this.useComputed(open));
    }
}
flushSync(() => root.render(React.createElement(Reader)));
const mountBodies = bodies;
const mountRenders = renders;
bodies = renders = 0;
store.draft.items[5] = {...store.draft.items[5], title: 'edited'};
const recordedPaths = engine(store, 'writes').size;
const titlePathOnly = [...engine(store, 'writes')].join(',') === 'items.5.title';
flushSync(() => store.emitUpdate());
const replacementBodies = bodies;
const replacementRenders = renders;
const equalText = container.textContent;
bodies = renders = 0;
flushSync(() => store.update(draft => { draft.items[5] = {...draft.items[5], done: true}; }));
const changedBodies = bodies;
const changedRenders = renders;
const text = container.textContent;
const done = equalText === '4000' && text === '3999' && store.getData().items[5].title === 'edited'
    && store.getData().items[5].done && store.getData().items[6].title === 'row 6';
flushSync(() => root.unmount());
emit({mountBodies, mountRenders, recordedPaths, titlePathOnly, replacementBodies, replacementRenders, changedBodies, changedRenders, text, done});

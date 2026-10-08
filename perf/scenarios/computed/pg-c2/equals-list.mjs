/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// JS-R15-03: toggle-and-back forces a fresh equal array; a no-equals reader proves publication.
import {emit, load, setupReact} from '../../../harness/lib.mjs';
const {Carburetor, computed, AntiHookComponent} = await load();
const {React, flushSync, root, container} = await setupReact();
const results = {};
for (const mode of ['equals', 'identity']) {
    const store = new Carburetor({items: [{title: 'a', done: false}, {title: 'b', done: true}, {title: 'c', done: false}]});
    let bodies = 0;
    let comparisons = 0;
    const visible = computed(read => {
        bodies++;
        return read(store).items.filter(item => !item.done).map(item => item.title);
    }, mode === 'equals' ? {equals: (before, after) => {
        comparisons++;
        return before.length === after.length && before.every((value, index) => value === after[index]);
    }} : undefined);
    const renders = Array(20).fill(0);
    class Reader extends AntiHookComponent {
        render() {
            renders[this.props.id]++;
            return React.createElement('span', null, this.useComputed(visible).join(','));
        }
    }
    flushSync(() => root.render(React.createElement('div', null,
        ...renders.map((_, id) => React.createElement(Reader, {key: id, id})))));
    results[mode + 'MountOnce'] = renders.every(value => value === 1);
    renders.fill(0);
    bodies = comparisons = 0;
    flushSync(() => store.update(draft => {
        draft.items[1].done = false;
        draft.items[1].done = true;
    }));
    results[mode + 'EqualRenders'] = renders.reduce((sum, value) => sum + value, 0);
    results[mode + 'EqualBodies'] = bodies;
    results[mode + 'EqualComparisons'] = comparisons;
    const equalText = container.textContent;
    renders.fill(0);
    bodies = comparisons = 0;
    flushSync(() => store.update(draft => { draft.items[1].done = false; }));
    results[mode + 'ChangedOnce'] = renders.every(value => value === 1);
    results[mode + 'ChangedRenders'] = renders.reduce((sum, value) => sum + value, 0);
    results[mode + 'ChangedBodies'] = bodies;
    results[mode + 'ChangedComparisons'] = comparisons;
    results[mode + 'Correct'] = equalText === 'a,c'.repeat(20) && container.textContent === 'a,b,c'.repeat(20);
    flushSync(() => root.render(null));
}
flushSync(() => root.unmount());
emit({...results, done: results.equalsCorrect && results.identityCorrect});

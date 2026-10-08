/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R33-05: a suppressed computed publication retains the reference on the next owner render.
import {emit, load, setupReact} from '../../../harness/lib.mjs';
const {Carburetor, computed, AntiHookComponent} = await load();
const {React, flushSync, root, container} = await setupReact();
const store = new Carburetor({items: [{id: 'a', title: 'first', done: false}]});
let bodies = 0;
let comparisons = 0;
let announcements = 0;
const visible = computed(read => {
    bodies++;
    return read(store).items.filter(item => !item.done && item.title.length > 0).map(item => item.id);
}, {equals: (before, after) => {
    comparisons++;
    return before.length === after.length && before.every((value, index) => value === after[index]);
}});
const listener = visible.subscribe(() => { announcements++; });
const renders = Array(100).fill(0);
const Child = React.memo(function Child({id, value}) {
    renders[id]++;
    return React.createElement('span', null, value.join(','));
});
class Owner extends AntiHookComponent {
    render() {
        return React.createElement(Child, {id: this.props.id, value: this.useComputed(visible)});
    }
}
const render = tick => flushSync(() => root.render(React.createElement('div', null,
    ...renders.map((_, id) => React.createElement(Owner, {key: id, id, tick})))));
render(0);
const mountOnce = renders.every(value => value === 1);
renders.fill(0);
bodies = comparisons = announcements = 0;
flushSync(() => store.update(draft => { draft.items[0].title = 'renamed'; }));
const equalBodies = bodies;
const equalComparisons = comparisons;
const equalAnnouncements = announcements;
render(1);
const equalRenders = renders.reduce((sum, value) => sum + value, 0);
const equalText = container.textContent;
renders.fill(0);
bodies = comparisons = announcements = 0;
flushSync(() => store.update(draft => { draft.items[0].done = true; }));
const changedOnce = renders.every(value => value === 1);
const changedRenders = renders.reduce((sum, value) => sum + value, 0);
const changedBodies = bodies;
const changedComparisons = comparisons;
const changedAnnouncements = announcements;
const done = equalText === 'a'.repeat(100) && container.textContent === '' && visible.get().length === 0;
flushSync(() => root.unmount());
visible.unsubscribe(listener);
emit({mountOnce, equalBodies, equalComparisons, equalAnnouncements, equalRenders, changedOnce, changedRenders,
    changedBodies, changedComparisons, changedAnnouncements, done});

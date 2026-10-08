/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// JS-R16-01: keyed list fixture from list-render-precision.test.tsx.
import {emit, load, setupReact} from '../../../../harness/lib.mjs';
const {AntiHookComponent, Carburetor} = await load();
const {React, flushSync, root, container} = await setupReact();
const count = Number(process.argv[2] ?? 4000);
const store = new Carburetor({items: Object.fromEntries(Array.from({length: count}, (_, i) => [i, {title: `row${i}`}]))});
let parents = 0;
let rows = 0;
class Row extends AntiHookComponent {
    render() {
        rows++;
        return React.createElement('li', null, this.useCarburetor(store).items[this.props.id].title);
    }
}
class Parent extends AntiHookComponent {
    render() {
        parents++;
        return React.createElement('ul', null, ...Object.keys(this.useCarburetor(store).items)
            .map(id => React.createElement(Row, {key: id, id})));
    }
}
flushSync(() => root.render(React.createElement(Parent)));
parents = rows = 0;
flushSync(() => store.update(draft => {draft.items[5].title = 'changed';}));
const editParentRenders = parents;
const editRowRenders = rows;
parents = rows = 0;
flushSync(() => store.update(draft => {draft.items[count] = {title: 'new'};}));
const relevantParentRenders = parents;
const newRowRenders = rows;
const done = Array.from(container.querySelectorAll('li')).every((li, i) =>
    li.textContent === (i === 5 ? 'changed' : i === count ? 'new' : `row${i}`))
    && container.querySelectorAll('li').length === count + 1;
flushSync(() => root.unmount());
emit({editParentRenders, editRowRenders, relevantParentRenders, newRowRenders, done});

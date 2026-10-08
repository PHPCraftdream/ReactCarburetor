/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// JS-R16-05: fixture from precise-drift.test.tsx.
import {emit, load, setupReact} from '../../../../harness/lib.mjs';
const {AntiHookComponent, Carburetor} = await load();
const {React, flushSync, root, container} = await setupReact();
const count = Number(process.argv[2] ?? 4000);
const store = new Carburetor({items: Object.fromEntries(Array.from({length: count}, (_, i) => [i, {title: `row${i}`} ])), other: 0});
let rowRenders = 0;
let writes = 0;
class Early extends AntiHookComponent {
    useEffects() {
        writes++;
        store.update(draft => {draft.other++;});
    }
    render() {return React.createElement('div');}
}
class Row extends AntiHookComponent {
    render() {
        rowRenders++;
        return React.createElement('li', null, this.useCarburetor(store).items[this.props.id].title);
    }
}
class Rows extends AntiHookComponent {
    render() {
        return React.createElement('ul', null, ...Object.keys(this.useCarburetor(store).items)
            .map(id => React.createElement(Row, {key: id, id})));
    }
}
flushSync(() => root.render(React.createElement('div', null, React.createElement(Early), React.createElement(Rows))));
flushSync(() => {});
const mountRowRenders = rowRenders;
rowRenders = 0;
flushSync(() => store.update(draft => {draft.items[5].title = 'changed';}));
const relevantRowRenders = rowRenders;
const done = writes === 1 && container.querySelectorAll('li').length === count
    && Array.from(container.querySelectorAll('li')).every((li, i) => li.textContent === (i === 5 ? 'changed' : `row${i}`));
flushSync(() => root.unmount());
emit({mountRowRenders, relevantRowRenders, writes, done});

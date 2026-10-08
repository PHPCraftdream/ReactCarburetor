/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// JS-R14-02/03/04: map, length-loop and for-of fixtures from list-render-precision.test.tsx.
import {emit, load, setupReact} from '../../../../harness/lib.mjs';
const {AntiHookComponent, Carburetor} = await load();
const {React, flushSync, root, container} = await setupReact();
const count = Number(process.argv[2] ?? 1000);
const metrics = {};
let done = true;
for (const mode of ['map', 'push', 'replace', 'splice', 'forOf']) {
    const store = new Carburetor({items: Array.from({length: count}, (_, i) => ({title: `row${i}`})), other: 0});
    let parents = 0;
    let rows = 0;
    class Row extends AntiHookComponent {
        render() {
            rows++;
            return React.createElement('li', null, this.useCarburetor(store).items[this.props.index].title);
        }
    }
    const row = index => React.createElement(Row, {key: index, index});
    class Parent extends AntiHookComponent {
        render() {
            parents++;
            const data = this.useCarburetor(store);
            if (mode === 'forOf') {
                let length = 0;
                for (const _item of data.items) length++;
                return React.createElement('span', null, String(length));
            }
            if (mode === 'map') return React.createElement('ul', null, ...data.items.map((_item, i) => row(i)));
            const children = [];
            for (let i = 0; i < data.items.length; i++) children.push(row(i));
            return React.createElement('ul', null, ...children);
        }
    }
    flushSync(() => root.render(React.createElement(Parent)));
    parents = rows = 0;
    flushSync(() => store.update(draft => {
        if (mode === 'map') draft.items[5].title = 'changed';
        else if (mode === 'push') draft.items.push({title: 'new'});
        else if (mode === 'replace') draft.items[5] = {title: 'changed'};
        // Same-length splice isolates one changed slot rather than shifted positional readers.
        else if (mode === 'splice') draft.items.splice(5, 1, {title: 'changed'});
        else draft.other++;
    }));
    metrics[mode + 'ParentRenders'] = parents;
    metrics[mode + 'RowRenders'] = rows;
    const expected = Array.from({length: count}, (_, i) => i === 5 && ['map', 'replace', 'splice'].includes(mode) ? 'changed' : `row${i}`);
    if (mode === 'push') expected.push('new');
    done &&= mode === 'forOf' ? container.textContent === String(count)
        : JSON.stringify(Array.from(container.querySelectorAll('li'), li => li.textContent)) === JSON.stringify(expected);
    parents = rows = 0;
    flushSync(() => store.update(draft => {
        if (mode === 'map' || mode === 'forOf') draft.items.push({title: 'control'});
        else draft.items[5].title = 'control';
    }));
    metrics[mode + 'RelevantRenders'] = mode === 'map' || mode === 'forOf' ? parents : rows;
    if (mode === 'forOf') done &&= container.textContent === String(count + 1);
    else {
        if (mode === 'map') expected.push('control');
        else expected[5] = 'control';
        done &&= JSON.stringify(Array.from(container.querySelectorAll('li'), li => li.textContent)) === JSON.stringify(expected);
    }
    flushSync(() => root.render(null));
}
flushSync(() => root.unmount());
emit({...metrics, done});

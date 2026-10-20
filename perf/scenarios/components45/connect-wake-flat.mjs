/* oxlint-disable react/globals, carburetor/require-tsdoc */
// A flat connectSelection wake verdicts through the one-level walk: delivery constructs no
// graph collections for flat rows, and a nested selection still reconciles exactly.
// Args: [rows=128]
import {emit, load, setupReact} from '../../harness/lib.mjs';

const {AntiHookComponent, Carburetor} = await load();
const {React, flushSync, root, container} = await setupReact();

const rows = Number(process.argv[2] ?? 128);
class S extends Carburetor { run(fn) { this.update(fn); } }
const data = {
    rows: Array.from({length: rows}, (_, index) => ({id: index, title: 't' + index})),
    nested: {deep: {count: 0}},
};
const store = new S(data);

let flatRenders = 0;
let nestedRenders = 0;

const flatRow = index => class extends AntiHookComponent {
    row = this.connectSelection(() => store, d => ({title: d.rows[index].title}));

    render() {
        flatRenders++;
        return React.createElement('p', {className: 'flat-' + index}, this.row().title);
    }
};

const mounted = [];
for (let index = 0; index < rows; index++) {
    const Row = flatRow(index);
    mounted.push(React.createElement(Row, {key: index}));
}

class Nested extends AntiHookComponent {
    view = this.connectSelection(() => store, d => ({deep: {...d.nested.deep}}));

    render() {
        nestedRenders++;
        return React.createElement('p', {className: 'nested'}, String(this.view().deep.count));
    }
}

mounted.push(React.createElement(Nested, {key: 'nested'}));
flushSync(() => root.render(React.createElement(React.Fragment, null, mounted)));
const flatInitial = flatRenders;
const nestedInitial = nestedRenders;
const flatText = container.querySelector('.flat-5')?.textContent;

// Count graph-collection constructions while one related write is delivered.
const NativeWeakMap = globalThis.WeakMap;
const NativeWeakSet = globalThis.WeakSet;
let collections = 0;
globalThis.WeakMap = class extends NativeWeakMap {
    constructor(...args) { super(...args); collections++; }
};
globalThis.WeakSet = class extends NativeWeakSet {
    constructor(...args) { super(...args); collections++; }
};
try {
    flushSync(() => store.run(draft => { draft.rows[5].title = 'changed'; }));
} finally {
    globalThis.WeakMap = NativeWeakMap;
    globalThis.WeakSet = NativeWeakSet;
}
const flatAfterWrite = flatRenders;
const flatTextAfter = container.querySelector('.flat-5')?.textContent;
const quietRows = flatRenders - flatInitial;

// The nested selection still reconciles through the full walk and updates the DOM.
flushSync(() => store.run(draft => { draft.nested.deep.count = 4; }));
const nestedTextAfter = container.querySelector('.nested')?.textContent;
const nestedCorrect = nestedTextAfter === '4';

flushSync(() => root.unmount());

const flatCorrect = flatInitial === rows && flatText === 't5' && flatTextAfter === 'changed';

emit({
    rows, collections,
    flatInitial, flatAfterWrite, quietRows,
    nestedInitial, nestedCorrect,
    flatCorrect,
    done: flatCorrect && nestedCorrect && quietRows === 1 && nestedInitial === 1,
});

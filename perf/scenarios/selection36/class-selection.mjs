/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R36-02 and R36-01 for the class API. Rows render `selectedId === id` through connectSelection (gated) and through
// connect (control): renders per selection move. A parent selecting the live list: paths read per render with no write
// and per related write; the control disables the write log and the drift answer so every render walks the list.
// Args: [rows=2000] [moves=6]
import {emit, load, setupReact} from '../../harness/lib.mjs';

const {AntiHookComponent, Carburetor} = await load();
const {React, flushSync, root, container} = await setupReact();
const PATHS_SINCE = Symbol.for('react-carburetor/v1/store-paths-since');
const HAS_DRIFT = Symbol.for('react-carburetor/v1/subscription-has-drift');

class Counting extends Carburetor {
    recorded = 0;
    read(record) { return super.read(path => { this.recorded++; record(path); }); }
    run(fn) { this.update(fn); }
}

const rows = Number(process.argv[2] ?? 2000);
const moves = Number(process.argv[3] ?? 6);

// Gated rows against plain connect rows: renders per move of the shared selection.
const selection = new Counting({selectedId: 0});
let gated = 0;
let plain = 0;
class GatedRow extends AntiHookComponent {
    on = this.connectSelection(() => selection, d => d.selectedId === this.props.id);
    render() { gated++; return React.createElement('i', {className: this.on() ? 'on' : 'off'}); }
}
class PlainRow extends AntiHookComponent {
    view = this.connect(() => selection);
    render() { plain++; return React.createElement('b', {className: this.view.selectedId === this.props.id ? 'on' : 'off'}); }
}
const ids = Array.from({length: rows}, (_, id) => id);
flushSync(() => root.render(React.createElement('div', null,
    ids.map(id => React.createElement(GatedRow, {key: 'g' + id, id})),
    ids.map(id => React.createElement(PlainRow, {key: 'p' + id, id})))));
gated = 0; plain = 0;
for (let i = 1; i <= moves; i++) flushSync(() => selection.run(d => { d.selectedId = i * 3; }));
const gatedPerMove = gated / moves;
const plainPerMove = plain / moves;
const lastOn = container.querySelector('i.on') === null ? 'none' : String(Array.from(container.querySelectorAll('i')).findIndex(n => n.className === 'on'));
flushSync(() => root.render(null));

// A parent selecting the live list.
const parent = async disable => {
    const store = new Counting({items: Array.from({length: rows}, (_, id) => ({id, title: 'T' + id})), other: 0});
    if (disable) {
        Object.defineProperty(store, PATHS_SINCE, {value: undefined});
        Object.defineProperty(store, HAS_DRIFT, {value: undefined});
    }
    let bump;
    class List extends AntiHookComponent {
        state = {n: 0};
        items = this.connectSelection(() => store, d => d.items);
        render() { bump = () => this.setState({n: this.state.n + 1}); return React.createElement('p', null, this.items()[3].title); }
    }
    flushSync(() => root.render(React.createElement(List)));
    flushSync(() => bump());
    store.recorded = 0;
    flushSync(() => bump());
    const noWrite = store.recorded;
    store.recorded = 0;
    flushSync(() => store.run(d => { d.items[3].title = 'edited'; }));
    const related = store.recorded;
    const text = container.textContent;
    flushSync(() => root.render(null));
    return {noWrite, related, text};
};
const fast = await parent(false);
const full = await parent(true);

emit({
    gatedRowRendersPerMove: gatedPerMove, plainRowRendersPerMove: plainPerMove, selectedRow: lastOn,
    parentReadsNoWrite: fast.noWrite, parentReadsPerRelatedWrite: fast.related, controlParentReads: full.noWrite,
    text: `${fast.text}|${full.text}`,
});
root.unmount();

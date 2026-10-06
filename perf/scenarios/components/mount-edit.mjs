/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R6-04: AntiHookComponent mount/edit/replace/unmount over one store. Render counts are the
// exact mechanism; times are generous JSDOM ceilings. Args: [rows=4000] [samples=5]
import {emit, load, median, setupReact} from '../../harness/lib.mjs';

const {AntiHookComponent, Carburetor} = await load();
const {React, flushSync, root, container} = await setupReact();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 4000);
const samples = Number(process.argv[3] ?? 5);
let rowRenders = 0;
let pageRenders = 0;

const buildData = () => {
    const items = {};
    const ids = [];
    for (let i = 0; i < rows; i++) {
        const id = 'row' + i;
        ids.push(id);
        items[id] = {title: 'Row ' + i};
    }
    items.rowAlt = {title: 'Alt row'};
    return {ids, items};
};

class Row extends AntiHookComponent {
    /** One list row: reads its own title through useCarburetor. */
    render() {
        rowRenders++;
        const {store, id} = this.props;
        return React.createElement('li', null, this.useCarburetor(store).items[id].title);
    }
}

class Page extends AntiHookComponent {
    /** The row list: reads the id order and mounts one Row per id. */
    render() {
        pageRenders++;
        const ids = this.useCarburetor(this.props.store).ids;
        return React.createElement('ul', null, ids.map((id, index) =>
            React.createElement(Row, {key: index, id, store: this.props.store})));
    }
}

const store = new S(buildData());
const time = body => {
    const start = performance.now();
    flushSync(body);
    return performance.now() - start;
};

global.gc?.();
const mountMs = time(() => root.render(React.createElement(Page, {store})));
const edits = [];
const editRenders = [];
for (let i = 0; i < samples; i++) {
    rowRenders = 0;
    edits.push(time(() => store.run(draft => { draft.items.row0.title = 'edited-' + i; })));
    editRenders.push(rowRenders);
}
const rendered = container.querySelectorAll('li');
const text = rendered[0].textContent + '|' + rendered.length;
const replaces = [];
const replacePageRenders = [];
for (let i = 0; i < samples; i++) {
    pageRenders = 0;
    replaces.push(time(() => store.run(draft => {
        draft.ids[0] = draft.ids[0] === 'row0' ? 'rowAlt' : 'row0';
    })));
    replacePageRenders.push(pageRenders);
}
const unmountMs = time(() => root.unmount());
emit({
    mountMs, editMs: median(edits), replaceMs: median(replaces), unmountMs,
    rowRendersPerEdit: median(editRenders), pageRendersPerReplace: median(replacePageRenders),
    text,
});

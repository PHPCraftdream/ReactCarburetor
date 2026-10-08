/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// JS-R13-05: production row reads do not note live views (the parent noted one view per row).
// The module moved between builds, so both paths are tried; a direct call is the seam control.
// Args: [rows=4000]
import {emit, load, loadPath} from '../../../../harness/lib.mjs';

const rows = Number(process.argv[2] ?? 4000);
const paths = ['Carburetor/Store/Tracking/Proxy/liveViews.mjs', 'Carburetor/Store/Tracking/liveViews.mjs'];
let liveViews;
for (const path of paths) {
    try { liveViews = (await loadPath(path)).liveViews; } catch { continue; }
    if (liveViews) break;
}
const {AntiHookComponent, Carburetor} = await load();
const {renderToString} = await import('react-dom/server');
const React = (await import('react')).default;

const noteIsFunction = typeof liveViews?.note === 'function';
const originalNote = liveViews.note;
let notes = 0;
liveViews.note = function (...args) {
    notes++;
    return Reflect.apply(originalNote, this, args);
};
let html = '';
let seamNotes = 0;
let renderNotes = 0;
try {
    const items = {};
    for (let i = 0; i < rows; i++) items['row' + i] = {title: 'Row ' + i};
    const store = new Carburetor({items});
    class Row extends AntiHookComponent {
        /** One list row reading its title. */
        render() {
            return React.createElement('li', null, this.useCarburetor(store).items[this.props.id].title);
        }
    }
    class Page extends AntiHookComponent {
        /** The whole list. */
        render() {
            const ids = [];
            for (let i = 0; i < rows; i++) ids.push('row' + i);
            return React.createElement('ul', null, ids.map((id, index) =>
                React.createElement(Row, {key: index, id, store})));
        }
    }
    notes = 0;
    html = renderToString(React.createElement(Page));
    renderNotes = notes;
    notes = 0;
    liveViews.note({});
    seamNotes = notes;
} finally {
    liveViews.note = originalNote;
}
emit({
    rows, renderNotes, seamNotes, noteIsFunction,
    rowsRendered: html.split('<li>').length - 1,
    done: html.includes('Row ' + (rows - 1)),
});

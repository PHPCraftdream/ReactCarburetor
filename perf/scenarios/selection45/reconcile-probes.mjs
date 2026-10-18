/* oxlint-disable react/globals, carburetor-internal/require-tsdoc */
// A full selection reconcile resolves each member's raw graph object once instead of probing
// the RAW_TARGET hatch two to three times per member. Args: [rows=1000] [wakes=6]
import {emit, load, setupReact} from '../../harness/lib.mjs';

const {AntiHookComponent, Carburetor} = await load();
const {React, flushSync, root, container} = await setupReact();
const RAW_TARGET = Symbol.for('react-carburetor.rawTarget');

const rows = Number(process.argv[2] ?? 1000);
const wakes = Number(process.argv[3] ?? 6);
class S extends Carburetor { run(fn) { this.update(fn); } }
const store = new S({
    items: Array.from({length: rows}, (_, index) => ({n: index, title: 't' + index})),
});
let checksum = 0;
let renderCount = 0;
let lastTitleSeen = undefined;

class List extends AntiHookComponent {
    view = this.connectSelection(() => store, data => ({
        rows: data.items.map(row => ({n: row.n, title: row.title})),
    }));

    render() {
        renderCount++;
        const snapshot = this.view();
        checksum = 0;
        for (const row of snapshot.rows) checksum += row.n;
        // The snapshot must carry every title write, not only the untouched fields.
        lastTitleSeen = snapshot.rows[0].title;
        return React.createElement('p', null, String(checksum));
    }
}

flushSync(() => root.render(React.createElement(List)));
const initialRenders = renderCount;
const initialChecksum = checksum;
const initialText = container.querySelector('p')?.textContent;

// Every selector run mints fresh row objects, so each wake pays one full reconcile walk.
const rawGet = Reflect.get;
let probes = 0;
Reflect.get = function (object, key, ...rest) {
    if (key === RAW_TARGET) probes++;
    return rawGet.call(this, object, key, ...rest);
};
try {
    for (let index = 0; index < wakes; index++) {
        flushSync(() => store.run(draft => { draft.items[0].title = 'w' + index; }));
    }
} finally {
    Reflect.get = rawGet;
}
const probesPerWake = probes / wakes;
const wakeRenders = renderCount - initialRenders;
const finalText = container.querySelector('p')?.textContent;
const lastTitleExpected = 'w' + (wakes - 1);

flushSync(() => root.unmount());

emit({
    rows, wakes, probesPerWake,
    initialRenders, wakeRenders,
    initialChecksum, finalChecksum: checksum,
    initialText, finalText,
    lastTitleSeen, lastTitleExpected,
    titleFresh: lastTitleSeen === lastTitleExpected && finalText === initialText,
    done: initialRenders === 1 && wakeRenders === wakes && initialChecksum === checksum
        && initialText === String(rows * (rows - 1) / 2) && finalText === initialText
        && lastTitleSeen === lastTitleExpected,
});

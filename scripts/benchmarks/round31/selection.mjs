import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {basename, isAbsolute, resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';

const suppliedRoot = process.argv[2];
assert(suppliedRoot && isAbsolute(suppliedRoot),
    'Usage: node scripts/benchmarks/round31/selection.mjs <absolute-dist/cjs-prod-or-esm-prod> [label]');

const distRoot = resolve(suppliedRoot);
const format = basename(distRoot);
assert(format === 'cjs-prod' || format === 'esm-prod', 'Distribution root must be cjs-prod or esm-prod');
const extension = format === 'cjs-prod' ? 'js' : 'mjs';
const label = process.argv[3] || format;
const require = createRequire(import.meta.url);

const loadDistributionModule = async (modulePath) => {
    const filename = resolve(distRoot, `${modulePath}.${extension}`);

    assert(existsSync(filename), `Missing production module: ${filename}`);

    return extension === 'js' ? require(filename) : import(pathToFileURL(filename).href);
};

const [{Carburetor, AntiHookComponent}, {sameSelection}, {detachOpaque}, {useCarburetorValue}] = await Promise.all([
    loadDistributionModule('Carburetor/index'),
    loadDistributionModule('Carburetor/Component/Connection/sameSelection'),
    loadDistributionModule('Carburetor/Store/Utils/Selection/detachOpaque'),
    loadDistributionModule('Interop/index'),
]);

const rounds = 3;
const median = (values) => {
    const ordered = [...values].sort((a, b) => a - b);

    return ordered[Math.floor(ordered.length / 2)];
};

const makeRows = (length, dense) => {
    const rows = [];
    rows.length = length;

    if (dense) {
        for (let index = 0; index < length; index++) rows[index] = index;
    } else {
        rows[0] = 0;
        rows[length - 1] = length - 1;
    }

    return rows;
};

const countArrayIndexKeys = (keys) => {
    let count = 0;

    for (const key of keys) {
        if (typeof key !== 'string') continue;
        const index = Number(key);
        if (Number.isInteger(index) && index >= 0 && index < 0xFFFFFFFF && String(index) === key) count++;
    }

    return count;
};

const inspectKernelWork = (rows) => {
    const originalOwnKeys = Reflect.ownKeys;
    const originalHasOwn = Object.prototype.hasOwnProperty;
    const work = {arrayOwnKeyCalls: 0, presentIndexKeys: 0, arrayHasOwnChecks: 0};

    Reflect.ownKeys = (value) => {
        const keys = originalOwnKeys(value);

        if (Array.isArray(value)) {
            work.arrayOwnKeyCalls++;
            work.presentIndexKeys += countArrayIndexKeys(keys);
        }

        return keys;
    };
    Object.prototype.hasOwnProperty = function (key) {
        if (Array.isArray(this)) work.arrayHasOwnChecks++;

        return originalHasOwn.call(this, key);
    };

    try {
        const snapshot = detachOpaque(rows);
        assert.equal(snapshot.length, rows.length);
        assert.equal(snapshot[0], rows[0]);
        assert.equal(snapshot[rows.length - 1], rows[rows.length - 1]);
        assert.equal(sameSelection(snapshot, rows), true);
    } finally {
        Reflect.ownKeys = originalOwnKeys;
        Object.prototype.hasOwnProperty = originalHasOwn;
    }

    return work;
};

const runArrayConsumer = (length, dense) => {
    const updates = length >= 65_536 ? 5 : 10;
    const samples = [];
    let notifications = 0;

    for (let round = 0; round < rounds; round++) {
        const store = new Carburetor({marker: 0, rows: makeRows(length, dense)});
        const stop = store.watch(data => ({parity: data.marker % 2, rows: data.rows}), () => {
            notifications++;
        });
        const started = performance.now();

        for (let update = 1; update <= updates; update++) {
            store.setData({marker: update * 2, rows: makeRows(length, dense)});
        }

        samples.push(performance.now() - started);
        stop();
    }

    assert.equal(notifications, 0, 'same-content sparse/dense updates must stay suppressed');

    return {
        kind: 'array-selection', length, dense, presentSlots: dense ? length : 2, updates, rounds,
        notifications, medianMs: Number(median(samples).toFixed(3)),
    };
};

const makeNativeData = (count, marker, reverse = false) => {
    const entries = Array.from({length: count}, (_, index) => [`k${index}`, index]);
    const members = Array.from({length: count}, (_, index) => `s${index}`);

    if (reverse) {
        entries.reverse();
        members.reverse();
    }

    return {marker, map: new Map(entries), set: new Set(members)};
};

const nativeLabel = (selection) => {
    const mapKeys = Array.from(selection.map.keys());
    const setMembers = Array.from(selection.set);

    return {
        firstMapKey: mapKeys[0],
        lastMapKey: mapKeys[mapKeys.length - 1],
        firstSetMember: setMembers[0],
        lastSetMember: setMembers[setMembers.length - 1],
    };
};

const runNativeConsumer = (count) => {
    const updates = 12;
    const samples = [];
    let notifications = 0;

    for (let round = 0; round < rounds; round++) {
        const store = new Carburetor(makeNativeData(count, 0));
        const stop = store.watch(data => ({parity: data.marker % 2, map: data.map, set: data.set}), () => {
            notifications++;
        });
        const started = performance.now();

        for (let update = 1; update <= updates; update++) {
            store.setData(makeNativeData(count, update * 2));
        }

        samples.push(performance.now() - started);
        stop();
    }

    assert.equal(notifications, 0, 'same-order Map/Set snapshots must stay suppressed');

    const orderStore = new Carburetor(makeNativeData(count, 0));
    const observedOrders = [];
    const stopOrder = orderStore.watch(data => ({map: data.map, set: data.set}), (next) => {
        observedOrders.push(nativeLabel(next));
    });
    orderStore.setData(makeNativeData(count, 2, true));
    orderStore.setData(makeNativeData(count, 4));
    stopOrder();
    assert.ok(observedOrders.length === 0 || observedOrders.length === 2,
        'native order observation must match either the known baseline or corrected behavior');
    if (observedOrders.length === 2) {
        assert.equal(observedOrders[0].firstMapKey, `k${count - 1}`);
        assert.equal(observedOrders[0].firstSetMember, `s${count - 1}`);
        assert.equal(observedOrders[1].firstMapKey, 'k0');
        assert.equal(observedOrders[1].firstSetMember, 's0');
    }

    return {
        kind: 'native-selection', entries: count, sameOrderUpdates: updates, rounds, notifications,
        sameOrderMedianMs: Number(median(samples).toFixed(3)), reorderNotifications: observedOrders.length,
        observedOrders,
    };
};

const runHookRenderCheck = async () => {
    const React = require('react');
    const {JSDOM} = require('jsdom');
    const dom = new JSDOM('<div id="root"></div>');
    const prior = new Map();
    const globalNames = ['window', 'document', 'navigator', 'HTMLElement', 'MutationObserver'];

    for (const name of globalNames) prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const globalValues = {
        window: dom.window,
        document: dom.window.document,
        navigator: dom.window.navigator,
        HTMLElement: dom.window.HTMLElement,
        MutationObserver: dom.window.MutationObserver,
    };

    for (const name of globalNames) {
        Object.defineProperty(globalThis, name, {configurable: true, writable: true, value: globalValues[name]});
    }

    const {flushSync} = require('react-dom');
    const {createRoot} = require('react-dom/client');
    const store = new Carburetor(makeNativeData(16, 0));
    let renders = 0;
    const View = () => {
        renders++;
        const selection = useCarburetorValue(store, data => ({map: data.map, set: data.set}));
        const text = `${nativeLabel(selection).firstMapKey}|${nativeLabel(selection).firstSetMember}`;

        return React.createElement('span', null, text);
    };
    const container = dom.window.document.getElementById('root');
    const root = createRoot(container);
    const classStore = new Carburetor(makeNativeData(16, 0));
    let memoRenders = 0;
    const MemoNative = React.memo(({selection}) => {
        memoRenders++;
        const native = nativeLabel(selection);

        return React.createElement('span', null, `${native.firstMapKey}|${native.firstSetMember}`);
    });
    class Parent extends AntiHookComponent {
        /** Connect the native selection.
         *
         * @param props - component props.
         */
        constructor(props) {
            super(props);
            this.selected = this.connectSelection(
                () => classStore,
                data => ({map: data.map, set: data.set})
            );
        }

        /** Render the memoized native consumer. */
        render() {
            return React.createElement(MemoNative, {selection: this.selected()});
        }
    }
    const classContainer = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(classContainer);
    const classRoot = createRoot(classContainer);
    const dateStore = new Carburetor({marker: 0, date: new Date(Number.NaN)});
    let dateRenders = 0;
    let dateNotifications = 0;
    const stopDate = dateStore.watch(data => ({parity: data.marker % 2, date: data.date}), () => {
        dateNotifications++;
    });
    const DateView = () => {
        dateRenders++;
        const selection = useCarburetorValue(dateStore, data => ({
            parity: data.marker % 2,
            date: data.date,
        }));

        return React.createElement('span', null, `${selection.parity}:${selection.date.getTime()}`);
    };
    const dateContainer = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(dateContainer);
    const dateRoot = createRoot(dateContainer);

    try {
        flushSync(() => root.render(React.createElement(View)));
        assert.equal(container.textContent, 'k0|s0');
        assert.equal(renders, 1);

        flushSync(() => store.setData(makeNativeData(16, 2)));
        assert.equal(container.textContent, 'k0|s0');
        assert.equal(renders, 1, 'an equal ordered snapshot must not re-render the hook consumer');

        flushSync(() => store.setData(makeNativeData(16, 4, true)));
        assert.ok(renders === 1 || renders === 2, 'reorder must either be suppressed by the baseline or rendered');
        const orderVisible = renders === 2;
        assert.equal(container.textContent, orderVisible ? 'k15|s15' : 'k0|s0');
        flushSync(() => classRoot.render(React.createElement(Parent)));
        assert.equal(classContainer.textContent, 'k0|s0');
        assert.equal(memoRenders, 1);

        flushSync(() => classStore.setData(makeNativeData(16, 2)));
        assert.equal(classContainer.textContent, 'k0|s0');
        assert.equal(memoRenders, 1, 'an equal ordered selection must keep the memo child stable');

        flushSync(() => classStore.setData(makeNativeData(16, 4, true)));
        assert.ok(memoRenders === 1 || memoRenders === 2,
            'reorder must either be suppressed by the baseline or rendered in the memo child');
        const classOrderVisible = memoRenders === 2;
        assert.equal(classContainer.textContent, classOrderVisible ? 'k15|s15' : 'k0|s0');


        flushSync(() => dateRoot.render(React.createElement(DateView)));
        assert.equal(dateContainer.textContent, '0:NaN');
        assert.equal(dateRenders, 1);

        flushSync(() => dateStore.setData({marker: 2, date: new Date(Number.NaN)}));
        assert.ok(dateNotifications === 0 || dateNotifications === 1);
        assert.ok(dateRenders === 1 || dateRenders === 2);
        const sameInvalidNotifications = dateNotifications;
        const sameInvalidRenders = dateRenders;
        assert.equal(dateContainer.textContent, '0:NaN');

        flushSync(() => dateStore.setData({marker: 4, date: new Date(0)}));
        assert.equal(dateContainer.textContent, '0:0');
        assert.equal(dateNotifications, sameInvalidNotifications + 1);
        assert.equal(dateRenders, sameInvalidRenders + 1);

        flushSync(() => dateStore.setData({marker: 6, date: new Date(Number.NaN)}));
        assert.equal(dateContainer.textContent, '0:NaN');
        assert.equal(dateNotifications, sameInvalidNotifications + 2);
        assert.equal(dateRenders, sameInvalidRenders + 2);

        flushSync(() => dateStore.setData({marker: 8, date: new Date(1)}));
        assert.equal(dateContainer.textContent, '0:1');
        assert.equal(dateNotifications, sameInvalidNotifications + 3);
        assert.equal(dateRenders, sameInvalidRenders + 3);

        return {
            kind: 'react-render-counts',
            nativeOrderHook: {sameOrderRenders: 1, afterReorderRenders: renders, orderVisible,
                textAfterReorder: container.textContent},
            nativeOrderMemoChild: {sameOrderRenders: 1, afterReorderRenders: memoRenders,
                orderVisible: classOrderVisible, textAfterReorder: classContainer.textContent},
            invalidDateHook: {sameInvalidNotifications, sameInvalidRenders, finalNotifications: dateNotifications,
                finalRenders: dateRenders, finalText: dateContainer.textContent},
        };
    } finally {
        stopDate();
        flushSync(() => {
            root.unmount();
            dateRoot.unmount();
            classRoot.unmount();
        });
        dom.window.close();

        for (const name of globalNames) {
            const descriptor = prior.get(name);
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
        }
    }
};

console.log(JSON.stringify({kind: 'run', label, distribution: distRoot, rounds}));

for (const length of [256, 4096, 65_536]) {
    for (const dense of [false, true]) {
        const work = inspectKernelWork(makeRows(length, dense));
        const expectedPresent = dense ? length : 2;
        console.log(JSON.stringify({kind: 'array-kernel-work', length, dense, presentSlots: expectedPresent,
            ...work}));
        console.log(JSON.stringify(runArrayConsumer(length, dense)));
    }
}

console.log(JSON.stringify(runNativeConsumer(512)));
console.log(JSON.stringify(await runHookRenderCheck()));

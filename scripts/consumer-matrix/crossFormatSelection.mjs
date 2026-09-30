import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {run} from './matrix.mjs';
import {checkEngineBoundaries} from './engineBoundaryChecks.mjs';

/**
 * A packed CJS store's plain-object/Map-key selection and plain/array/native-root
 * connections must preserve detached graph identity for ESM class and hook readers.
 * Runs against `<installDir>/node_modules/react-carburetor`, not the repo's `dist/`.
 */
const SCRIPT = `
const path = require('path');
const assert = require('node:assert/strict');
const pkgRoot = path.join(process.cwd(), 'node_modules', 'react-carburetor');
const toFileUrl = (file) => 'file:///' + path.resolve(file).split(path.sep).join('/');
const checkEngineBoundaries = (${checkEngineBoundaries.toString()});
const engineCases = [];

(async () => {
    const React = require('react');
    const {renderToStaticMarkup} = require('react-dom/server');
    const cjs = require(path.join(pkgRoot, 'dist', 'cjs', 'Carburetor', 'index.js'));
    const esm = await import(toFileUrl(path.join(pkgRoot, 'dist', 'esm', 'Carburetor', 'index.mjs')));
    const {useCarburetorValue} = await import(
        toFileUrl(path.join(pkgRoot, 'dist', 'esm', 'Interop', 'index.mjs'))
    );

    const selections = [];
    class GraphStore extends cjs.Carburetor {
        changeKey() {
            this.update((draft) => { draft.key.id = 2; });
        }
        changeIndex() {
            this.update((draft) => { draft.index.set(draft.key, 'updated'); });
        }
    }
    for (const order of ['key-first', 'map-first']) {
        const key = {id: 1};
        const store = new GraphStore({key, index: new Map([[key, 'answer']])});
        const select = (view) => order === 'key-first'
            ? {key: view.key, index: view.index} : {index: view.index, key: view.key};
        const handedOut = [];
        const content = (value) => String(value.index.get(value.key)) + ':' +
            String(value.key === value.index.keys().next().value);

        class ClassReader extends esm.AntiHookComponent {
            constructor(props) {
                super(props);
                this.selected = this.connectSelection(() => store, select);
            }
            render() {
                const value = this.selected();
                handedOut.push(value);
                return React.createElement('span', null, content(value));
            }
        }
        function HookReader() {
            const value = useCarburetorValue(store, select);
            handedOut.push(value);
            return React.createElement('span', null, content(value));
        }

        const klass = renderToStaticMarkup(React.createElement(ClassReader));
        const hook = renderToStaticMarkup(React.createElement(HookReader));
        const aliases = handedOut.every((value) => value.index.get(value.key) === 'answer'
            && value.key === value.index.keys().next().value
            && value.key !== key && value.index !== store.getData().index);
        handedOut[0].key.id = 99;
        handedOut[1].index.set(handedOut[1].key, 'changed');
        const detached = key.id === 1 && store.getData().index.get(key) === 'answer';

        const notifications = [];
        const stop = store.watch(select, (next) => notifications.push([next.key.id, content(next)]));
        store.changeKey();
        store.changeIndex();
        stop();

        selections.push({order, klass, hook, aliases, detached, notifications});
    }

    const nativeMap = (n) => {
        const map = new Map([['id', n]]);
        map.set(map, 'self');
        Object.defineProperty(map, 'hidden', {value: {self: map}, enumerable: false});
        return map;
    };
    const nativeStore = new cjs.Carburetor(nativeMap(1));
    let selectedNative;
    class NativeReader extends esm.AntiHookComponent {
        constructor(props) {
            super(props);
            this.live = this.connect(() => nativeStore);
            this.selected = this.connectSelection(() => nativeStore, () => this.live);
        }
        render() {
            const value = this.selected();
            selectedNative = value;
            return React.createElement('span', null, String(value.get('id')) + ':' +
                String(value.get(value) === 'self' && value.hidden.self === value));
        }
    }
    const nativeInitial = renderToStaticMarkup(React.createElement(NativeReader));
    selectedNative.set('id', 99);
    const nativeDetached = nativeStore.getData().get('id') === 1;
    nativeStore.setData(nativeMap(2));
    const nativeNext = renderToStaticMarkup(React.createElement(NativeReader));

    const rootFields = (root) => Array.isArray(root)
        ? {index: root[0], members: root[1], id: root[2]} : root;
    const makeAliasRoot = (kind, id) => {
        const array = kind === 'array' || kind === 'objectArray' || kind === 'nullArray';
        const root = array ? [] : Object.create(kind === 'null' ? null : Object.prototype);
        if (kind === 'objectArray' || kind === 'nullArray') {
            Object.setPrototypeOf(root, kind === 'nullArray' ? null : Object.prototype);
        }
        Object.defineProperty(root, array ? '0' : 'index', {
            value: new Map([[root, 'answer' + id]]), enumerable: true, writable: true, configurable: false
        });
        Object.defineProperty(root, array ? '1' : 'members', {
            value: new Set([root]), enumerable: true, writable: true, configurable: false
        });
        Object.defineProperty(root, array ? '2' : 'id', {
            value: id, enumerable: true, writable: true, configurable: false
        });
        return root;
    };
    const roots = [];
    for (const kind of ['object', 'null', 'array', 'objectArray', 'nullArray']) {
        for (const order of ['raw-first', 'proxy-first']) {
            const store = new cjs.Carburetor(makeAliasRoot(kind, 1));
            const snapshots = [];
            class AliasRootReader extends esm.AntiHookComponent {
                constructor(props) {
                    super(props);
                    this.live = this.connect(() => store);
                    this.selected = this.connectSelection(() => store, () => {
                        const {index, members} = rootFields(this.live);
                        return order === 'raw-first'
                            ? {index, members, root: this.live}
                            : {root: this.live, index, members};
                    });
                }
                render() {
                    const value = this.selected();
                    snapshots.push(value);
                    const root = value.root;
                    const flags = Object.getOwnPropertyDescriptor(root, Array.isArray(root) ? '2' : 'id');
                    return React.createElement('span', null, String(rootFields(root).id) + ':' +
                        String(value.index.get(root)) + ':' + String(value.members.has(root)) + ':' +
                        String(flags.configurable));
                }
            }
            const initial = renderToStaticMarkup(React.createElement(AliasRootReader));
            const first = snapshots[0];
            const aliases = first.index === rootFields(first.root).index
                && first.members === rootFields(first.root).members
                && first.root !== store.getData();
            first.index.set(first.root, 'consumer edit');
            first.members.delete(first.root);
            const detached = rootFields(store.getData()).index.get(store.getData()) === 'answer1'
                && rootFields(store.getData()).members.has(store.getData());
            store.setData(makeAliasRoot(kind, 2));
            const next = renderToStaticMarkup(React.createElement(AliasRootReader));
            roots.push({kind, order, initial, next, aliases, detached});
        }
    }

    const histories = [];
    for (const [label, storeModule, historyModule] of [
        ['cjs-store/esm-history', cjs, esm],
        ['esm-store/cjs-history', esm, cjs],
    ]) {
        const replay = (kind, initial, mutate, changed, restored) => {
            const store = new storeModule.Carburetor(initial);
            const history = new historyModule.CarburetorHistory(store);
            const check = (expected) => {
                assert.deepStrictEqual(store.getData(), expected, label + ': ' + kind);
                assert.equal(Object.hasOwn(store.getData(), 'y'), Object.hasOwn(expected, 'y'),
                    label + ': ' + kind + ' changed whether y is an own property');
                assert.equal(Object.getOwnPropertySymbols(store.getData()).length, 0,
                    label + ': ' + kind + ' leaked a protocol symbol into state');
            };
            mutate(store);
            check(changed);
            assert.equal(history.undo(), true, label + ': ' + kind + ' undo');
            check(restored);
            assert.equal(history.redo(), true, label + ': ' + kind + ' redo');
            check(changed);
            history.disconnect();
            histories.push(label + ':' + kind);
        };
        replay('value', {x: 0}, (store) => store.update((draft) => { draft.x = 1; }),
            {x: 1}, {x: 0});
        replay('addition', {x: 0}, (store) => store.update((draft) => { draft.y = 7; }),
            {x: 0, y: 7}, {x: 0});
        replay('deletion', {x: 0, y: 7}, (store) => store.update((draft) => { delete draft.y; }),
            {x: 0}, {x: 0, y: 7});
        replay('opaque', {x: 0}, (store) => store.setData({x: 1}),
            {x: 1}, {x: 0});
        const marker = Symbol.for('react-carburetor/v1/patch-absent');
        const ordinary = Symbol('consumer-state');
        replay('marker-value', {x: 0}, (store) => store.update((draft) => { draft.x = marker; }),
            {x: marker}, {x: 0});
        replay('marker-previous', {x: marker}, (store) => store.update((draft) => { draft.x = 7; }),
            {x: 7}, {x: marker});
        replay('ordinary-symbol', {x: marker}, (store) => store.update((draft) => { draft.x = ordinary; }),
            {x: ordinary}, {x: marker});
        replay('marker-addition', {x: 0}, (store) => store.update((draft) => { draft.y = marker; }),
            {x: 0, y: marker}, {x: 0});
        replay('undefined-addition', {x: 0}, (store) => store.update((draft) => { draft.y = undefined; }),
            {x: 0, y: undefined}, {x: 0});
        replay('marker-deletion', {x: 0, y: marker}, (store) => store.update((draft) => { delete draft.y; }),
            {x: 0}, {x: 0, y: marker});
        replay('define-marker', {x: 0}, (store) => store.update((draft) => {
            Object.defineProperty(draft, 'y',
                {value: marker, writable: true, configurable: true, enumerable: true});
        }), {x: 0, y: marker}, {x: 0});
        replay('sparse-symbols', {rows: [0, marker, undefined, , ordinary]},
            (store) => store.update((draft) => { draft.rows.length = 1; }),
            {rows: [0]}, {rows: [0, marker, undefined, , ordinary]});
        const branchBefore = Object.assign(Object.create(null), {'a.b': marker, gone: undefined});
        const branchAfter = Object.assign(Object.create(null), {'a.b': ordinary, added: marker});
        replay('null-prototype-symbols', {branch: branchBefore},
            (store) => store.update((draft) => { draft.branch = branchAfter; }),
            {branch: branchAfter}, {branch: branchBefore});
        replay('symbol-setData', {x: marker, y: undefined},
            (store) => store.setData({x: ordinary, added: marker}),
            {x: ordinary, added: marker}, {x: marker, y: undefined});

        for (const kind of ['Map', 'Set', 'Date']) {
            for (const nested of [false, true]) {
                const native = kind === 'Map' ? new Map([['value', 1]])
                    : kind === 'Set' ? new Set([1]) : new Date(1);
                const initial = nested ? {native} : native;
                Object.defineProperty(native, 'owner',
                    {value: initial, enumerable: false, writable: true, configurable: true});
                const store = new storeModule.Carburetor(initial);
                const snapshot = store.snapshot();
                assert.equal(nested ? snapshot.native : snapshot, native,
                    label + ': snapshot must still share opaque native data');
                const history = new historyModule.CarburetorHistory(store);
                const value = () => nested ? store.getData().native : store.getData();
                const checkNative = (expected) => {
                    const current = value();
                    assert.equal(kind === 'Map' ? current.get('value')
                        : kind === 'Set' ? [...current][0] : current.getTime(), expected);
                    assert.equal(current.owner, store.getData(), label + ': native root backlink');
                };
                const change = (next) => store.update((draft) => {
                    const current = nested ? draft.native : draft;
                    if (kind === 'Map') current.set('value', next);
                    else if (kind === 'Set') { current.clear(); current.add(next); }
                    else current.setTime(next);
                });
                change(2);
                assert.equal(history.undo(), true);
                checkNative(1);
                assert.equal(history.redo(), true);
                checkNative(2);
                const handedOut = value();
                if (kind === 'Map') handedOut.set('value', 99);
                else if (kind === 'Set') { handedOut.clear(); handedOut.add(99); }
                else handedOut.setTime(99);
                assert.equal(history.undo(), true);
                checkNative(1);
                assert.equal(history.redo(), true);
                checkNative(2);
                assert.equal(history.undo(), true);
                change(3);
                assert.equal(history.redo(), false, label + ': fresh native write discards future');
                assert.equal(history.undo(), true);
                checkNative(1);
                assert.equal(history.redo(), true);
                checkNative(3);
                history.disconnect();
                histories.push(label + ':native-' + kind + (nested ? '-nested' : '-root'));
            }
        }

        for (const replaceKey of [false, true]) {
            const key = {id: 'key'};
            const store = new storeModule.Carburetor({key, map: new Map([[key, 'one']])});
            const history = new historyModule.CarburetorHistory(store);
            store.update((draft) => {
                if (replaceKey) draft.key = {id: 'replacement'};
                else draft.map.set(key, 'two');
            });
            assert.equal(history.undo(), true);
            assert.equal(store.getData().map.get(store.getData().key), 'one',
                label + ': native/plain key alias on undo');
            assert.equal(history.redo(), true);
            assert.equal(store.getData().map.get(store.getData().key), replaceKey ? undefined : 'two',
                label + ': native/plain key alias on redo');
            history.disconnect();
            histories.push(label + (replaceKey ? ':native-key-replacement' : ':native-key-alias'));
        }

        const viewKey = {id: 1};
        const keyed = new storeModule.Carburetor({key: viewKey,
            map: new Map([[viewKey, 1]]), set: new Set()});
        const keyedHistory = new historyModule.CarburetorHistory(keyed);
        const values = [];
        const stopKeyed = keyed.watch((view) => view.map.get(view.key), (value) => values.push(value));
        const derived = new historyModule.Computed((get) => {
            const view = get(keyed);
            return view.map.get(view.key);
        });
        assert.equal(derived.get(), 1);
        keyed.update((draft) => {
            draft.map.set(draft.key, 2);
            draft.map.set('root', draft);
            draft.set.add(draft.key);
        });
        const checkKeys = () => {
            const state = keyed.getData();
            assert.equal(state.map.get(state.key), 2);
            assert.equal(state.map.size, 2);
            assert.equal(state.map.get('root'), state);
            assert.equal(state.set.has(state.key), true);
            assert.equal(derived.get(), 2);
        };
        checkKeys();
        assert.deepStrictEqual(values, [2]);
        assert.equal(keyedHistory.undo(), true);
        assert.equal(derived.get(), 1);
        assert.equal(keyedHistory.redo(), true);
        checkKeys();
        stopKeyed();
        keyedHistory.disconnect();
        histories.push(label + ':native-view-keys');

        for (const postClear of [false, true]) {
            const jobs = new Map();
            const scheduler = {
                schedule: (id, callback) => jobs.set(id, callback),
                cancel: (id) => jobs.delete(id),
            };
            const store = new storeModule.Carburetor({count: 0}, scheduler);
            const history = new historyModule.CarburetorHistory(store);
            const independent = postClear ? undefined : new historyModule.CarburetorHistory(store);
            store.update((draft) => { draft.count = 1; });
            history.clear();
            if (postClear) store.update((draft) => { draft.count = 2; });
            const pending = [...jobs.values()];
            jobs.clear();
            pending.forEach((callback) => callback());
            assert.equal(history.canUndo(), postClear, label + ': clear discarded pre-clear writes');
            if (postClear) {
                assert.equal(history.undo(), true);
                assert.equal(store.getData().count, 1, label + ': undo cannot cross clear baseline');
                assert.equal(history.redo(), true);
                assert.equal(store.getData().count, 2);
            } else {
                assert.equal(independent.undo(), true, label + ': clear kept independent history');
                assert.equal(store.getData().count, 0);
            }
            history.disconnect();
            independent?.disconnect();
            histories.push(label + (postClear ? ':clear-post-write' : ':clear-deferred'));
        }
        for (const opaque of [false, true]) {
            const jobs = new Map();
            const scheduler = {schedule: (id, callback) => jobs.set(id, callback),
                cancel: (id) => jobs.delete(id)};
            const store = new storeModule.Carburetor(opaque ? new Map([['count', 0]]) : {count: 0}, scheduler);
            const history = new historyModule.CarburetorHistory(store);
            const put = (next) => store.update((draft) => {
                if (opaque) draft.set('count', next); else draft.count = next;
            });
            const count = () => opaque ? store.getData().get('count') : store.getData().count;
            const flush = () => {
                while (jobs.size) {
                    const callbacks = [...jobs.values()]; jobs.clear();
                    callbacks.forEach((callback) => callback());
                }
            };
            put(1); flush(); put(2);
            assert.equal(history.undo(), true);
            assert.equal(count(), 1, label + ': undo must reverse the pending latest write');
            flush();
            assert.equal(count(), 1);
            assert.equal(history.canRedo(), true);
            assert.equal(history.redo(), true);
            flush();
            assert.equal(count(), 2);
            assert.equal(history.undo(), true);
            put(3);
            assert.equal(history.redo(), false, label + ': a fresh pending branch discards future');
            flush();
            assert.equal(count(), 3);
            history.disconnect();
            histories.push(label + (opaque ? ':pending-opaque-replay' : ':pending-patch-replay'));
        }

        for (const kind of ['Map', 'Set', 'Date']) {
            for (const nested of [false, true]) {
                const native = kind === 'Map' ? new Map([['value', 1]])
                    : kind === 'Set' ? new Set([1]) : new Date(1);
                const store = new storeModule.Carburetor(nested ? {native} : native);
                const history = new historyModule.CarburetorHistory(store);
                store.update((draft) => {
                    const current = nested ? draft.native : draft;
                    if (kind === 'Map') current.get('value');
                    else if (kind === 'Set') current.has(1);
                    else current.getTime();
                });
                const version = store.getVersion();
                assert.equal(history.canUndo(), false, label + ': a native read is not a history edit');
                assert.equal(history.undo(), false);
                assert.equal(store.getVersion(), version);
                history.disconnect();
                histories.push(label + ':readOnly-' + kind + (nested ? '-nested' : '-root'));
            }
        }


        const resource = new storeModule.ResourceCarburetor(async (key) => 'answer-' + key);
        const resourceHistory = new historyModule.CarburetorHistory(resource);
        await resource.load('a');
        assert.equal(resourceHistory.undo(), true, label + ': resource undo');
        assert.equal(resource.getData().status, storeModule.EResourceStatus.Idle);
        assert.equal(resourceHistory.redo(), true, label + ': resource redo');
        assert.equal(resource.snapshot().key, JSON.stringify('a'));
        assert.equal(resource.suspend('a'), 'answer-a');
        resourceHistory.disconnect();
        histories.push(label + ':resource');

        let loads = 0;
        const manual = new storeModule.ResourceCarburetor(async (key) => {
            loads++;
            return 'network-' + key;
        });
        await manual.load('a');
        const settled = manual.getData();
        manual.setData(settled);
        assert.equal(manual.snapshot().key, JSON.stringify('a'));
        let observedKey;
        manual.subscribe(() => { observedKey = manual.snapshot().key; });
        manual.setData({...settled});
        assert.equal(observedKey, undefined, label + ': key loss was visible at publication');
        let pendingLoad;
        try { manual.suspend('a'); } catch (value) { pendingLoad = value; }
        assert.ok(pendingLoad instanceof Promise, label + ': keyless answer must not satisfy old args');
        await pendingLoad;
        assert.equal(loads, 2);
        assert.equal(manual.suspend('a'), 'network-a');
        histories.push(label + ':keyless-slot');

        const rawFailure = new Error('same');
        rawFailure.code = 'old-entry';
        const cache = new storeModule.ResourceCache(async () => { throw rawFailure; });
        await cache.load('a').catch(() => {});
        assert.equal(cache.getFailure('a'), rawFailure);
        let replacementFailure;
        cache.subscribe(() => {
            try { cache.suspend('a'); } catch (value) { replacementFailure = value; }
        });
        const cacheKey = cache.keyOf('a');
        cache.update((draft) => {
            const previous = draft.entries[cacheKey];
            draft.entries[cacheKey] = {...previous, updatedAt: (previous.updatedAt ?? 0) + 1};
        });
        assert.ok(replacementFailure instanceof Error);
        assert.notEqual(replacementFailure, rawFailure);
        assert.equal(replacementFailure.message, 'same');
        assert.equal(replacementFailure.code, undefined);
        assert.equal(cache.getFailure('a'), undefined);
        histories.push(label + ':entry-owned-failure');
        engineCases.push(...await checkEngineBoundaries(assert, storeModule, historyModule, label));
    }

    process.stdout.write(JSON.stringify({
        selections, nativeInitial, nativeNext, nativeDetached, roots, histories, engineCases
    }));
})().catch((error) => {
    process.stderr.write(String((error && error.stack) || error));
    process.exit(1);
});
`;

/** Checks actual CJS-store/ESM-consumer selection behavior in an installed package. */
export const runCrossFormatSelection = (installDir) => {
    const directory = mkdtempSync(join(installDir, '.cross-format-'));
    const file = join(directory, 'probe.cjs');
    let result;
    try {
        writeFileSync(file, SCRIPT);
        result = run(process.execPath, [file], {cwd: installDir});
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }

    if (!result.ok) {
        return {ok: false, stderr: result.stdout + result.stderr};
    }

    let parsed;

    try {
        parsed = JSON.parse(result.stdout);
    } catch (error) {
        return {ok: false, stderr: 'could not parse probe output (' + String(error) + '): ' + result.stdout};
    }

    if (
        parsed.selections?.length !== 2 ||
        parsed.selections[0].order !== 'key-first' ||
        parsed.selections[1].order !== 'map-first' ||
        !parsed.selections.every((entry) => entry.aliases && entry.detached
            && entry.klass === '<span>answer:true</span>'
            && entry.hook === '<span>answer:true</span>'
            && entry.notifications.length === 2
            && entry.notifications[0][0] === 2 && entry.notifications[0][1] === 'answer:true'
            && entry.notifications[1][0] === 2 && entry.notifications[1][1] === 'updated:true')
    ) {
        return {ok: false, stderr: 'cross-format class/hook selection lost its detached Map-key alias: '
            + JSON.stringify(parsed.selections)};
    }

    if (parsed.nativeInitial !== '<span>1:true</span>' || parsed.nativeNext !== '<span>2:true</span>'
        || !parsed.nativeDetached) {
        return {ok: false, stderr: 'cross-format native-root connection failed to detach and retarget: '
            + JSON.stringify({
                initial: parsed.nativeInitial,
                next: parsed.nativeNext,
                detached: parsed.nativeDetached
            })};
    }

    if (parsed.roots?.length !== 10 || !parsed.roots.every((entry) => entry.aliases && entry.detached
        && entry.initial === '<span>1:answer1:true:false</span>'
        && entry.next === '<span>2:answer2:true:false</span>')) {
        return {ok: false, stderr: 'cross-format root facade lost its Map/Set identity or data: '
            + JSON.stringify(parsed.roots)};
    }

    const historyKinds = [
        'value', 'addition', 'deletion', 'opaque', 'marker-value', 'marker-previous',
        'ordinary-symbol', 'marker-addition', 'undefined-addition', 'marker-deletion',
        'define-marker', 'sparse-symbols', 'null-prototype-symbols', 'symbol-setData',
        'native-Map-root', 'native-Map-nested', 'native-Set-root', 'native-Set-nested',
        'native-Date-root', 'native-Date-nested', 'native-key-alias', 'native-key-replacement',
        'native-view-keys', 'clear-deferred', 'clear-post-write',
        'pending-patch-replay', 'pending-opaque-replay',
        'readOnly-Map-root', 'readOnly-Map-nested', 'readOnly-Set-root', 'readOnly-Set-nested',
        'readOnly-Date-root', 'readOnly-Date-nested', 'resource', 'keyless-slot', 'entry-owned-failure',
    ];
    const expectedHistories = ['cjs-store/esm-history', 'esm-store/cjs-history']
        .flatMap((label) => historyKinds.map((kind) => label + ':' + kind));
    if (JSON.stringify(parsed.histories) !== JSON.stringify(expectedHistories)) {
        return {ok: false, stderr: 'cross-format history cases did not finish: '
            + JSON.stringify(parsed.histories)};
    }

    const boundaryKinds = ['alias-map-value', 'alias-set-member', 'alias-map-key', 'alias-native-own',
        'alias-root-link', 'length-root-flag-only', 'length-root-truncate',
        'length-nested-flag-only', 'length-nested-truncate',
        'connected-length-descriptor', 'cache-preloader-cancel',
        'key-order-replacement', 'key-order-deletion-selection', 'watch-complete-leaf-reads',
        'native-equal-content-retarget', 'readonly-snapshot-restore', 'readonly-history-replay'];
    const expectedBoundaries = ['cjs-store/esm-history', 'esm-store/cjs-history']
        .flatMap(label => boundaryKinds.map(kind => label + ':' + kind));
    if (JSON.stringify(parsed.engineCases) !== JSON.stringify(expectedBoundaries)) {
        return {ok: false, stderr: 'cross-format native alias/array descriptor cases did not finish: '
            + JSON.stringify(parsed.engineCases)};
    }

    return {ok: true};
};

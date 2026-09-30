import {run} from './matrix.mjs';

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
            const key = this.getData().key;
            this.update((draft) => { draft.index.set(key, 'updated'); });
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
    }

    process.stdout.write(JSON.stringify({selections, nativeInitial, nativeNext, nativeDetached, roots, histories}));
})().catch((error) => {
    process.stderr.write(String((error && error.stack) || error));
    process.exit(1);
});
`;

/** Checks actual CJS-store/ESM-consumer selection behavior in an installed package. */
export const runCrossFormatSelection = (installDir) => {
    const result = run(process.execPath, ['-e', SCRIPT], {cwd: installDir});

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

    const expectedHistories = [
        'cjs-store/esm-history:value', 'cjs-store/esm-history:addition',
        'cjs-store/esm-history:deletion', 'cjs-store/esm-history:opaque',
        'cjs-store/esm-history:resource', 'esm-store/cjs-history:value',
        'esm-store/cjs-history:addition', 'esm-store/cjs-history:deletion',
        'esm-store/cjs-history:opaque', 'esm-store/cjs-history:resource',
    ];
    if (JSON.stringify(parsed.histories) !== JSON.stringify(expectedHistories)) {
        return {ok: false, stderr: 'cross-format history cases did not finish: '
            + JSON.stringify(parsed.histories)};
    }

    return {ok: true};
};

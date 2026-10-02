import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {basename, isAbsolute, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {existsSync} from 'node:fs';

process.env.NODE_ENV = 'production';

const distributionRootArg = process.argv[2];
if (!distributionRootArg || !isAbsolute(distributionRootArg)) {
    throw new Error('Usage: node scripts/benchmarks/round31/readable.mjs <absolute production distribution root>');
}

const distributionRoot = resolve(distributionRootArg);
const format = basename(distributionRoot);
if (format !== 'cjs-prod' && format !== 'esm-prod') {
    throw new Error('Distribution root must be named cjs-prod or esm-prod.');
}

const extension = format === 'cjs-prod' ? 'js' : 'mjs';
const interopEntry = resolve(distributionRoot, `Interop/index.${extension}`);
assert.ok(existsSync(interopEntry), `Missing production interop entry: ${interopEntry}`);

const require = createRequire(import.meta.url);
const interop = format === 'cjs-prod'
    ? require(interopEntry)
    : await import(pathToFileURL(interopEntry).href);
const {JSDOM} = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
Object.defineProperty(globalThis, 'navigator', {configurable: true, value: dom.window.navigator});

const React = require('react');
const {createRoot} = require('react-dom/client');
const {flushSync} = require('react-dom');
const {useCarburetorValue} = interop;

class ReadableSource {
    /** Initialize an external readable source.
     *
     * @param data - initial state.
     */
    constructor(data) {
        this.data = data;
        this.uid = 'round31-readable';
        this.version = 0;
        this.nextId = 0;
        this.listeners = new Map();
        this.notifications = 0;
        this.writes = 0;
    }

    /** Stable source identity. */
    getUID() {
        return this.uid;
    }

    /** Current write version. */
    getVersion() {
        return this.version;
    }

    /** Raw state for untracked readers. */
    getData() {
        return this.data;
    }

    /** Create a tracked view.
     *
     * @param record - dependency recorder.
     */
    read(record) {
        return new Proxy(this.data, {
            get: (target, key, receiver) => {
                if (typeof key === 'string') {
                    record(key);
                }
                return Reflect.get(target, key, receiver);
            },
        });
    }

    /** Register a reader.
     *
     * @param callback - notification handler.
     * @param options - identity and recorded reads.
     */
    subscribe(callback, options = {}) {
        const id = options.id ?? `${this.uid}:${++this.nextId}`;
        this.listeners.set(id, {
            callback,
            reads: options.reads === undefined ? undefined : new Set(options.reads),
        });
        return id;
    }

    /** Release a reader.
     *
     * @param id - subscription identity.
     */
    unsubscribe(id) {
        this.listeners.delete(id);
    }

    /** Publish an external replacement.
     *
     * @param data - next state.
     * @param changedPaths - changed dependency names.
     */
    replace(data, changedPaths) {
        this.data = data;
        this.version++;
        this.writes++;

        const listeners = Array.from(this.listeners.values());
        for (const listener of listeners) {
            if (listener.reads === undefined ||
                [...listener.reads].some((read) => changedPaths.has(read))) {
                this.notifications++;
                listener.callback();
            }
        }
    }
}

const source = new ReadableSource({active: false, primary: 'p0', secondary: 's0'});
let componentRenders = 0;
let selectionEvaluations = 0;
const selectValue = (data) => {
    selectionEvaluations++;
    return data.active ? data.primary : data.secondary;
};

const Consumer = () => {
    componentRenders++;
    return React.createElement('output', null, useCarburetorValue(source, selectValue));
};

const root = createRoot(document.getElementById('root'));
flushSync(() => root.render(React.createElement(Consumer)));
assert.equal(document.querySelector('output')?.textContent, 's0');

const rounds = 32;
let secondary = 's0';
for (let index = 1; index <= rounds; index++) {
    flushSync(() => source.replace(
        {active: true, primary: `p${index}`, secondary}, new Set(['active', 'primary'])
    ));
    assert.equal(document.querySelector('output')?.textContent, `p${index}`);

    const rendersBeforeUnselectedWrite = componentRenders;
    secondary = `s${index}`;
    flushSync(() => source.replace(
        {active: true, primary: `p${index}`, secondary}, new Set(['secondary'])
    ));
    assert.equal(componentRenders, rendersBeforeUnselectedWrite);

    flushSync(() => source.replace(
        {active: false, primary: `p${index}`, secondary}, new Set(['active'])
    ));
    assert.equal(document.querySelector('output')?.textContent, secondary);

    const rendersBeforeOtherUnselectedWrite = componentRenders;
    flushSync(() => source.replace(
        {active: false, primary: `p${index}-unselected`, secondary}, new Set(['primary'])
    ));
    assert.equal(componentRenders, rendersBeforeOtherUnselectedWrite);
}

flushSync(() => root.unmount());
assert.equal(source.listeners.size, 0);
assert.equal(source.notifications, rounds * 2);
assert.equal(componentRenders, rounds * 2 + 1);
assert.equal(selectionEvaluations, rounds * 2 + 1);

console.log(JSON.stringify({
    scenario: 'readable-adapter-conditional-selection',
    distributionRoot,
    writes: source.writes,
    selectedPathNotifications: source.notifications,
    unselectedWrites: rounds * 2,
    selectionEvaluations,
    componentRenders,
    finalValue: secondary,
    remainingSubscriptions: source.listeners.size,
}, null, 2));
dom.window.close();

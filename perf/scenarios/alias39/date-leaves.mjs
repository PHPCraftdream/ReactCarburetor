/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {emit, load} from '../../harness/lib.mjs';

if (!process.env.DIST_ROOT) throw new Error('DIST_ROOT is required');
const {Carburetor} = await load();
const size = Number(process.argv[2] ?? 10000);
const kind = process.argv[3] ?? 'Date';
if (!Number.isInteger(size) || size < 1 || !['Date', 'flat'].includes(kind)) {
    throw new Error('Expected positive size and Date/flat kind');
}

class FlatStamp {
    constructor(ms) { this.ms = ms; }
}

const countReads = run => {
    const original = {
        Set: globalThis.Set,
        ownKeys: Reflect.ownKeys,
        descriptor: Reflect.getOwnPropertyDescriptor,
        names: Object.getOwnPropertyNames,
        symbols: Object.getOwnPropertySymbols,
    };
    const counts = {sets: 0, ownKeys: 0, descriptors: 0, names: 0, symbols: 0, keyArrays: 0, keys: 0};
    globalThis.Set = new Proxy(original.Set, {
        construct(target, args, newTarget) {
            counts.sets++;
            return Reflect.construct(target, args, newTarget);
        },
    });
    const keys = (metric, operation, target) => {
        counts[metric]++;
        const result = operation(target);
        counts.keyArrays++;
        counts.keys += result.length;
        return result;
    };
    Reflect.ownKeys = target => keys('ownKeys', original.ownKeys, target);
    Reflect.getOwnPropertyDescriptor = (target, key) => {
        counts.descriptors++;
        return original.descriptor(target, key);
    };
    Object.getOwnPropertyNames = target => keys('names', original.names, target);
    Object.getOwnPropertySymbols = target => keys('symbols', original.symbols, target);
    try {
        run();
    } finally {
        globalThis.Set = original.Set;
        Reflect.ownKeys = original.ownKeys;
        Reflect.getOwnPropertyDescriptor = original.descriptor;
        Object.getOwnPropertyNames = original.names;
        Object.getOwnPropertySymbols = original.symbols;
    }
    return counts;
};

const controlObject = {value: 1, [Symbol('control')]: 2};
const control = countReads(() => {
    new Set();
    Reflect.ownKeys(controlObject);
    Reflect.getOwnPropertyDescriptor(controlObject, 'value');
    Object.getOwnPropertyNames(controlObject);
    Object.getOwnPropertySymbols(controlObject);
});

const store = new Carburetor({
    items: Array.from({length: size}, (_, i) => ({at: kind === 'Date' ? new Date(i) : new FlatStamp(i)})),
    meta: null,
});
const view = store.read(() => undefined);
let sum = 0;
const readAll = () => {
    sum = 0;
    for (let i = 0; i < size; i++) {
        const at = view.items[i].at;
        sum += kind === 'Date' ? at.getTime() : at.ms;
    }
};
readAll();
const warmCorrect = sum === size * (size - 1) / 2;
store.update(draft => { draft.meta = {}; });
const start = performance.now();
const counts = countReads(readAll);
const readAllMs = performance.now() - start;

const aliasControl = mode => {
    const member = {n: 1};
    const native = mode === 'Map' ? new Map([['member', member]]) : Object.assign(new FlatStamp(1), {child: member});
    const aliasStore = new Carburetor({alias: member, native, other: {n: 0}, meta: null});
    const reads = new Set();
    const aliasView = aliasStore.read(path => reads.add(path));
    const access = data => mode === 'Map' ? data.native.get('member') : data.native.child;
    access(aliasView);
    aliasStore.update(draft => { draft.meta = {}; });
    reads.clear();
    let exposed;
    const work = countReads(() => { exposed = access(aliasView); });
    const found = reads.has('alias') && exposed === aliasStore.getData().alias;
    const changes = [];
    const stop = aliasStore.watch(data => access(data).n, n => { changes.push(n); });
    let siblingQuiet;
    try {
        aliasStore.update(draft => { draft.other.n++; });
        siblingQuiet = changes.length === 0;
        aliasStore.update(draft => { draft.alias.n = 2; });
        aliasStore.update(draft => { draft.alias.n = 3; });
    } finally {
        stop();
    }
    return {found, wakes: changes.length, correct: found && siblingQuiet && changes.join(',') === '2,3', work};
};
const map = aliasControl('Map');
const child = aliasControl('child');

// A plain root must bypass the scalar-leaf shortcut and record wildcard dependence.
const backlink = new Date(0);
const rootStore = new Carburetor({native: backlink, other: {n: 0}});
const root = rootStore.getData();
Object.defineProperty(backlink, 'root', {value: root});
const rootReads = new Set();
const rootView = rootStore.read(path => rootReads.add(path));
const rootFound = rootView.native.root === root && rootReads.has('*');
let rootWakes = 0;
const rootId = rootStore.subscribe(() => { rootWakes++; }, {reads: rootReads});
try {
    rootStore.update(draft => { draft.other.n++; });
} finally {
    rootStore.unsubscribe(rootId);
}

// Key-array counters are diagnostic: stage1 is not allocation-free.
emit({
    setsPerReadAll: counts.sets,
    ownKeysPerReadAll: counts.ownKeys,
    descriptorsPerReadAll: counts.descriptors,
    propertyNamesPerReadAll: counts.names,
    propertySymbolsPerReadAll: counts.symbols,
    keyArraysPerReadAll: counts.keyArrays,
    keysPerReadAll: counts.keys,
    readAllMs,
    controlSets: control.sets,
    controlOwnKeys: control.ownKeys,
    controlDescriptors: control.descriptors,
    controlPropertyNames: control.names,
    controlPropertySymbols: control.symbols,
    controlKeyArrays: control.keyArrays,
    controlKeys: control.keys,
    mapAliasFound: map.found,
    mapWakes: map.wakes,
    mapSets: map.work.sets,
    mapOwnKeys: map.work.ownKeys,
    childAliasFound: child.found,
    childWakes: child.wakes,
    childSets: child.work.sets,
    childOwnKeys: child.work.ownKeys,
    rootFound,
    rootWakes,
    done: warmCorrect && sum === size * (size - 1) / 2 && map.correct && child.correct && rootFound && rootWakes === 1,
});

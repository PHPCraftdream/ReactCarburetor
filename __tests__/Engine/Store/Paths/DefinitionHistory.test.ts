import {Carburetor, CarburetorHistory} from '@/Carburetor';
import {IWritePatch, PATCH_ABSENT, TPatchPort} from '@/Carburetor/Models/Paths';
import {createWriteProxy} from '@/Carburetor/Store/Tracking/createWriteProxy';

class DefinitionStore<T extends object> extends Carburetor<T> {
    public edit(mutate: (draft: T) => void): void {
        this.update(mutate);
    }
}

const open = {enumerable: true, writable: true, configurable: true};

describe('R10-01: data definitions attribute their effective value', () => {
    test('omitted values and full same-value descriptors publish no state change', () => {
        const store = new DefinitionStore({count: 1, branch: {value: 2}});
        const branch = store.getData().branch;
        const history = new CarburetorHistory(store);
        let wakes = 0;
        const subscription = store.subscribe(() => wakes++);

        store.edit(draft => {
            Object.defineProperty(draft, 'count', open);
            Object.defineProperty(draft, 'branch', open);
            Object.defineProperty(draft, 'count', {value: 1, ...open});
            Object.defineProperty(draft, 'branch', {value: draft.branch, ...open});
            Object.defineProperty(draft, 'count', {});
        });

        expect(store.getData().count).toBe(1);
        expect(store.getData().branch).toBe(branch);
        expect(Object.getOwnPropertyDescriptor(store.getData(), 'branch')).toEqual({value: branch, ...open});
        expect(store.getVersion()).toBe(0);
        expect(wakes).toBe(0);
        expect(history.canUndo()).toBe(false);
        expect(history.undo()).toBe(false);
        expect(history.redo()).toBe(false);
        store.unsubscribe(subscription);
        history.disconnect();
    });

    test('explicit undefined and a changed object survive undo and redo', () => {
        const store = new DefinitionStore<{count: number | undefined; branch: {value: number}}>({
            count: 1, branch: {value: 2},
        });
        const history = new CarburetorHistory(store);
        let wakes = 0;
        const subscription = store.subscribe(() => wakes++);
        store.edit(draft => Object.defineProperty(draft, 'count', {value: undefined}));
        expect(store.getData().count).toBeUndefined();
        expect(Object.hasOwn(store.getData(), 'count')).toBe(true);
        expect(store.getVersion()).toBe(1);
        expect(wakes).toBe(1);
        expect(history.canUndo()).toBe(true);
        expect(history.undo()).toBe(true);
        expect(store.getData().count).toBe(1);
        expect(history.canRedo()).toBe(true);

        store.edit(draft => Object.defineProperty(draft, 'count', open));
        expect(history.canRedo()).toBe(true);
        expect(store.getVersion()).toBe(2);
        expect(wakes).toBe(2);
        expect(history.redo()).toBe(true);
        expect(store.getData().count).toBeUndefined();
        store.edit(draft => Object.defineProperty(draft, 'branch', {value: {value: 3}}));
        expect(store.getData().branch).toEqual({value: 3});
        expect(history.undo()).toBe(true);
        expect(store.getData().branch).toEqual({value: 2});
        expect(history.redo()).toBe(true);
        expect(store.getData().branch).toEqual({value: 3});
        expect(Object.getOwnPropertyDescriptor(store.getData(), 'branch')).toEqual({value: {value: 3}, ...open});
        store.unsubscribe(subscription);
        history.disconnect();
    });

    test('an omitted value on a new key creates an own undefined property and a reversible patch', () => {
        const store = new DefinitionStore<Record<string, unknown>>({});
        const history = new CarburetorHistory(store);
        store.edit(draft => Object.defineProperty(draft, 'created', open));
        expect(Object.keys(store.getData())).toEqual(['created']);
        expect(Object.getOwnPropertyDescriptor(store.getData(), 'created')).toEqual({value: undefined, ...open});
        expect(store.getVersion()).toBe(1);
        expect(history.undo()).toBe(true);
        expect(Object.keys(store.getData())).toEqual([]);
        expect(history.redo()).toBe(true);
        expect(Object.keys(store.getData())).toEqual(['created']);
        expect(store.getData().created).toBeUndefined();
        history.disconnect();
    });

    test('no-op definitions emit no patches and failed native definitions preserve descriptors', () => {
        const source = {count: NaN, branch: {value: 1}};
        const paths: string[] = [];
        const patches: unknown[] = [];
        const port: TPatchPort = {listener: patch => patches.push(patch)};
        const draft = createWriteProxy(source, path => paths.push(path), '', undefined, undefined, port);
        Object.defineProperty(draft, 'count', {value: NaN});
        Object.defineProperty(draft, 'branch', {});
        expect(paths).toEqual([]);
        expect(patches).toEqual([]);

        Object.defineProperty(source, 'count', {writable: false, configurable: false});
        expect(Reflect.defineProperty(draft, 'count', {value: 2})).toBe(false);
        expect(Reflect.defineProperty(draft, 'count', {value: NaN})).toBe(true);
        expect(Reflect.defineProperty(draft, 'count', {value: NaN, ...open})).toBe(false);
        expect(Object.getOwnPropertyDescriptor(source, 'count')).toEqual({
            value: NaN, enumerable: true, writable: false, configurable: false,
        });
        expect(paths).toEqual([]);
        expect(patches).toEqual([]);
    });
});

describe('R10-02: index definitions include native array growth', () => {
    test.each([1, 3])('extending at index %i announces only the index, keys and length', index => {
        const store = new DefinitionStore({items: [1]});
        const history = new CarburetorHistory(store);
        const lengthReads = new Set<string>();
        const keyReads = new Set<string>();
        const untouchedReads = new Set<string>();
        expect(store.read(path => lengthReads.add(path)).items.length).toBe(1);
        expect(Object.keys(store.read(path => keyReads.add(path)).items)).toEqual(['0']);
        expect(store.read(path => untouchedReads.add(path)).items[0]).toBe(1);
        let lengths = 0;
        let keys = 0;
        let untouched = 0;
        let changed = 0;
        const subscriptions = [
            store.subscribe(() => lengths++, {reads: lengthReads}),
            store.subscribe(() => keys++, {reads: keyReads}),
            store.subscribe(() => untouched++, {reads: untouchedReads}),
            store.subscribe(() => changed++, {reads: new Set(['items.' + index])}),
        ];
        store.edit(draft => Object.defineProperty(draft.items, String(index), {value: 4, ...open}));
        expect(store.getVersion()).toBe(1);
        expect([lengths, keys, untouched, changed]).toEqual([1, 1, 0, 1]);
        expect(store.getData().items.length).toBe(index + 1);
        expect(Object.keys(store.getData().items)).toEqual(['0', String(index)]);
        expect(Object.getOwnPropertyDescriptor(store.getData().items, String(index))).toEqual({value: 4, ...open});

        expect(history.undo()).toBe(true);
        expect(store.getData().items).toEqual([1]);
        expect(store.getData().items.length).toBe(1);
        expect(Object.keys(store.getData().items)).toEqual(['0']);
        expect(history.redo()).toBe(true);
        expect(store.getData().items.length).toBe(index + 1);
        expect(Object.keys(store.getData().items)).toEqual(['0', String(index)]);
        expect(store.getData().items[index]).toBe(4);
        expect([lengths, keys, untouched, changed]).toEqual([3, 3, 0, 3]);
        expect(store.getVersion()).toBe(3);
        subscriptions.forEach(id => store.unsubscribe(id));
        history.disconnect();
    });

    test('an in-range hole creates a key without changing length, then restores the hole', () => {
        const items = [1];
        items.length = 4;
        const store = new DefinitionStore({items});
        const history = new CarburetorHistory(store);
        let lengths = 0;
        let keys = 0;
        let untouched = 0;
        const subscriptions = [
            store.subscribe(() => lengths++, {reads: new Set(['items.length'])}),
            store.subscribe(() => keys++, {reads: new Set(['items.~k'])}),
            store.subscribe(() => untouched++, {reads: new Set(['items.0'])}),
        ];
        store.edit(draft => Object.defineProperty(draft.items, '2', {value: undefined, ...open}));
        expect(store.getVersion()).toBe(1);
        expect([lengths, keys, untouched]).toEqual([0, 1, 0]);
        expect(Object.keys(store.getData().items)).toEqual(['0', '2']);
        expect(history.undo()).toBe(true);
        expect(Object.keys(store.getData().items)).toEqual(['0']);
        expect(store.getData().items.length).toBe(4);
        expect(history.redo()).toBe(true);
        expect(Object.hasOwn(store.getData().items, '2')).toBe(true);
        expect(store.getData().items.length).toBe(4);
        expect([lengths, keys, untouched]).toEqual([0, 3, 0]);
        subscriptions.forEach(id => store.unsubscribe(id));
        history.disconnect();
    });

    test('replacing an existing index changes only its value and round-trips through history', () => {
        const store = new DefinitionStore({items: [1, 2]});
        const history = new CarburetorHistory(store);
        let lengths = 0;
        let keys = 0;
        let untouched = 0;
        let changed = 0;
        const subscriptions = [
            store.subscribe(() => lengths++, {reads: new Set(['items.length'])}),
            store.subscribe(() => keys++, {reads: new Set(['items.~k'])}),
            store.subscribe(() => untouched++, {reads: new Set(['items.0'])}),
            store.subscribe(() => changed++, {reads: new Set(['items.1'])}),
        ];
        store.edit(draft => Object.defineProperty(draft.items, '1', {value: 4}));
        expect(store.getData().items).toEqual([1, 4]);
        expect(store.getVersion()).toBe(1);
        expect([lengths, keys, untouched, changed]).toEqual([0, 0, 0, 1]);
        store.edit(draft => Object.defineProperty(draft.items, '1', open));
        store.edit(draft => Object.defineProperty(draft.items, '1', {value: 4, ...open}));
        expect(store.getVersion()).toBe(1);
        expect(history.undo()).toBe(true);
        expect(store.getData().items).toEqual([1, 2]);
        expect(history.redo()).toBe(true);
        expect(store.getData().items).toEqual([1, 4]);
        expect([lengths, keys, untouched, changed]).toEqual([0, 0, 0, 3]);
        subscriptions.forEach(id => store.unsubscribe(id));
        history.disconnect();
    });

    test('growth records the element before length, retaining absence and explicit undefined', () => {
        const source = [1];
        const paths: string[] = [];
        const patches: unknown[] = [];
        const port: TPatchPort = {listener: patch => patches.push(patch)};
        const draft = createWriteProxy(source, path => paths.push(path), '', undefined, undefined, port);
        Object.defineProperty(draft, '3', open);
        expect(source.length).toBe(4);
        expect(Object.hasOwn(source, '3')).toBe(true);
        expect(paths).toEqual(['~k', '3', 'length']);
        expect(patches).toEqual([
            {segments: ['3'], previous: PATCH_ABSENT, next: undefined},
            {segments: ['length'], previous: 1, next: 4},
        ] satisfies IWritePatch[]);
    });

    test('non-writable length and invalid descriptors leave no publication or history entry', () => {
        const items = [1];
        const store = new DefinitionStore({items});
        const history = new CarburetorHistory(store);
        Object.defineProperty(items, 'length', {writable: false});
        let wakes = 0;
        const subscription = store.subscribe(() => wakes++);
        store.edit(draft => {
            expect(Reflect.defineProperty(draft.items, '3', {value: 4, ...open})).toBe(false);
        });
        expect(() => store.edit(draft => Object.defineProperty(draft.items, '3', {value: 4, ...open})))
            .toThrow(TypeError);
        expect(() => store.edit(draft => Object.defineProperty(draft.items, '3', {value: 4})))
            .toThrow('non-plain-data');
        expect(() => store.edit(draft => Object.defineProperty(draft.items, '3', {...open, writable: false})))
            .toThrow('non-plain-data');
        expect(store.getData().items).toEqual([1]);
        expect(store.getData().items.length).toBe(1);
        expect(Object.keys(store.getData().items)).toEqual(['0']);
        expect(store.getVersion()).toBe(0);
        expect(wakes).toBe(0);
        expect(history.canUndo()).toBe(false);
        expect(history.canRedo()).toBe(false);
        store.unsubscribe(subscription);
        history.disconnect();

        const paths: string[] = [];
        const patches: unknown[] = [];
        const port: TPatchPort = {listener: patch => patches.push(patch)};
        const draft = createWriteProxy(items, path => paths.push(path), '', undefined, undefined, port);
        expect(Reflect.defineProperty(draft, '3', {value: 4, ...open})).toBe(false);
        expect(paths).toEqual([]);
        expect(patches).toEqual([]);
    });
});

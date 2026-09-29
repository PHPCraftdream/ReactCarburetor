import {Carburetor, CarburetorHistory} from '@/Carburetor';
import {TPatchPort} from '@/Carburetor/Models/Paths';
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

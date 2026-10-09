import {Carburetor} from '@/Carburetor';

const names = [
    'data', 'scheduler', 'subscribers', 'subscriptionGeneration', 'subscriberIndex', 'aliases',
    'patchPort', 'patchObservers', 'notifiedVersion', 'subscriptionByReads', 'writes', 'writeTargets',
    'writeLog', 'targetOwners', 'draftTouched', 'pendingEmit', 'unpublishedDraftCheck', 'draftProxy',
    'publicationPending', 'pendingPublication', 'activeInstallation', 'writeRecorder',
    'commitState', 'port', 'retract', 'rememberPublication', 'touchDraft', 'recordWrite',
];

/** Exercises only the documented subclass publication contract. */
class Store extends Carburetor<{n: number}> {
    /** Publishes one mutation. */
    public change(n: number): void { this.update(draft => { draft.n = n; }); }
    /** Publishes a deferred mutation. */
    public later(n: number): void { this.draft.n = n; this.emitSoon(); }
}

describe('R40-01 ordinary store names', () => {
    test('a base store owns no string-named engine fields', () => {
        expect(Object.getOwnPropertyNames(new Carburetor({n: 0}))).toEqual([]);
    });

    test('preEmit receives recorded paths and data remains a getter without a setter', () => {
        class Derived extends Store {
            public changed: string[][] = [];
            protected preEmit(changed: ReadonlySet<string>): void { this.changed.push([...changed]); }
            public raw(): {n: number} { return this.data; }
        }
        const store = new Derived({n: 0});
        store.change(1);
        store.change(1);
        expect(store.changed).toEqual([['n'], []]);
        expect(store.raw()).toBe(store.getData());
        const descriptor = Object.getOwnPropertyDescriptor(Carburetor.prototype, 'data');
        expect(typeof descriptor?.get).toBe('function');
        expect(descriptor?.set).toBeUndefined();
    });

    test.each(names)('shadowing %s cannot change engine state or delivery', async name => {
        class Shadow extends Store {
            constructor() {
                super({n: 0});
                Object.defineProperty(this, name, {value: 'domain', writable: true, configurable: true});
            }
        }
        const store = new Shadow();
        const seen: number[] = [];
        const id = store.subscribe(() => seen.push(store.getData().n));
        store.change(1);
        store.setData({n: 2});
        store.restore({n: 3});
        store.later(4);
        await Promise.resolve();
        expect(store.getData()).toEqual({n: 4});
        expect(seen).toEqual([1, 2, 3, 4]);
        expect(store.getVersion()).toBe(4);
        expect(Reflect.get(store, name)).toBe('domain');
        store.unsubscribe(id);
        store.change(5);
        expect(seen).toEqual([1, 2, 3, 4]);
    });
});

import {storeLifecycle} from '@/Carburetor/Store/Diagnostics/Internal/StoreLifecycle';

describe('storeLifecycle.onDispose', () => {
    test('finalizers run once, first, before the signal aborts and the steps run', () => {
        const store = {};
        const seen: string[] = [];
        const signal = storeLifecycle.signal(store);
        signal.addEventListener('abort', () => seen.push('abort'));
        storeLifecycle.after(store, 10, () => seen.push('timer'));
        storeLifecycle.onDispose(store, () => {
            seen.push(`finalizer disposed=${storeLifecycle.isDisposed(store)} aborted=${signal.aborted}`);
        });

        storeLifecycle.dispose(store, [() => seen.push('step')]);
        storeLifecycle.dispose(store, [() => seen.push('again')]);
        expect(seen).toEqual(['finalizer disposed=true aborted=false', 'abort', 'step']);
    });

    test('an unregistered finalizer does not run', () => {
        const store = {};
        const seen: string[] = [];
        const release = storeLifecycle.onDispose(store, () => seen.push('released'));
        storeLifecycle.onDispose(store, () => seen.push('kept'));

        release();
        storeLifecycle.dispose(store, []);
        expect(seen).toEqual(['kept']);
    });

    test('a disposed store never runs a finalizer registered afterwards', () => {
        const store = {};
        const seen: string[] = [];
        storeLifecycle.dispose(store, []);

        const release = storeLifecycle.onDispose(store, () => seen.push('late'));
        release();
        storeLifecycle.dispose(store, []);
        expect(seen).toEqual([]);
    });

    test('a throwing finalizer is rethrown after every other finalizer and step ran', () => {
        const store = {};
        const seen: string[] = [];
        storeLifecycle.onDispose(store, () => { throw new Error('first'); });
        storeLifecycle.onDispose(store, () => seen.push('second'));

        expect(() => storeLifecycle.dispose(store, [() => seen.push('step')])).toThrow('first');
        expect(seen).toEqual(['second', 'step']);
    });
});

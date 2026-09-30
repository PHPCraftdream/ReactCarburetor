import {Carburetor, ComponentUpdateThrottle} from '@/Carburetor';

class ManualThrottle extends ComponentUpdateThrottle {
    constructor() { super(60_000); }

    public flush(): void { this.letsUpdate(); }
}

const readPath = (store: Carburetor<{n: number; other: number}>, key: 'n' | 'other'): Set<string> => {
    const reads = new Set<string>();
    void store.read((path) => reads.add(path))[key];
    return reads;
};

describe('store-local subscriber IDs and delivery ownership', () => {
    test.each([['first', 'second'], ['second', 'first']] as const)(
        'shared throttle delivers both stores when %s publishes before %s', (first, second) => {
            const scheduler = new ManualThrottle();
            const stores = {
                first: new Carburetor({n: 0}, scheduler),
                second: new Carburetor({n: 0}, scheduler),
            };
            const calls: string[] = [];
            for (const name of ['first', 'second'] as const) {
                expect(stores[name].subscribe(() => calls.push(name), {id: 'view'})).toBe('view');
            }

            stores[first].setData({n: 1});
            stores[second].setData({n: 1});
            scheduler.flush();
            expect(calls).toEqual([first, second]);

            stores.first.unsubscribe('view');
            stores.second.unsubscribe('view');
        }
    );

    test('generated public IDs remain independent on a shared scheduler', () => {
        const scheduler = new ManualThrottle();
        const a = new Carburetor({n: 0}, scheduler);
        const b = new Carburetor({n: 0}, scheduler);
        const calls: string[] = [];
        const aId = a.subscribe(() => calls.push('a'));
        const bId = b.subscribe(() => calls.push('b'));
        expect(aId).not.toBe(bId);
        a.setData({n: 1});
        b.setData({n: 1});
        scheduler.flush();
        expect(calls).toEqual(['a', 'b']);
        a.unsubscribe(aId);
        b.unsubscribe(bId);
    });

    test('extensible store identities and arbitrary local IDs cannot alias scheduler slots', () => {
        class LabeledStore extends Carburetor<{n: number}> {
            constructor(label: string, scheduler: ManualThrottle) {
                super({n: 0}, scheduler);
                this.uid = label;
            }
        }
        const scheduler = new ManualThrottle();
        const a = new LabeledStore('label:child', scheduler);
        const b = new LabeledStore('label', scheduler);
        const calls: string[] = [];
        expect(a.subscribe(() => calls.push('a'), {id: 'view'})).toBe('view');
        expect(b.subscribe(() => calls.push('b'), {id: 'child:view'})).toBe('child:view');
        a.setData({n: 1});
        b.setData({n: 1});
        scheduler.flush();
        expect(calls).toEqual(['a', 'b']);

        b.setData({n: 2});
        a.setData({n: 2});
        a.unsubscribe('view');
        scheduler.flush();
        expect(calls).toEqual(['a', 'b', 'b']);
        b.unsubscribe('child:view');
    });

    test('cancelling one store cannot cancel another store with the same local ID', () => {
        const scheduler = new ManualThrottle();
        const a = new Carburetor({n: 0}, scheduler);
        const b = new Carburetor({n: 0}, scheduler);
        const calls: string[] = [];
        a.subscribe(() => calls.push('a'), {id: 'view'});
        b.subscribe(() => calls.push('b'), {id: 'view'});
        b.setData({n: 1});
        a.setData({n: 1});
        a.unsubscribe('view');
        scheduler.flush();
        expect(calls).toEqual(['b']);

        b.setData({n: 2});
        scheduler.flush();
        expect(calls).toEqual(['b', 'b']);
        b.unsubscribe('view');
    });

    test('a replacement during a shared flush cancels only the old registration', () => {
        const scheduler = new ManualThrottle();
        const a = new Carburetor({n: 0}, scheduler);
        const b = new Carburetor({n: 0}, scheduler);
        const calls: string[] = [];
        a.subscribe(() => {
            calls.push('a');
            b.subscribe(() => calls.push('replacement'), {id: 'view'});
        }, {id: 'view'});
        b.subscribe(() => calls.push('obsolete'), {id: 'view'});
        a.setData({n: 1});
        b.setData({n: 1});
        scheduler.flush();
        expect(calls).toEqual(['a']);

        a.unsubscribe('view');
        b.setData({n: 2});
        scheduler.flush();
        expect(calls).toEqual(['a', 'replacement']);
        b.unsubscribe('view');
    });

    test('sync replacement cannot receive the old event, but receives a newly matched nested write', () => {
        const store = new Carburetor({n: 0, other: 0});
        const calls: string[] = [];
        const nReads = readPath(store, 'n');
        const otherReads = readPath(store, 'other');
        store.subscribe(() => {
            calls.push('first');
            store.unsubscribe('target');
            store.subscribe(() => calls.push('new'), {id: 'target', reads: otherReads});
            store.setData({n: 1, other: 1});
        }, {id: 'first', reads: nReads});
        store.subscribe(() => calls.push('old'), {id: 'target', reads: nReads});
        store.setData({n: 1, other: 0});
        expect(calls).toEqual(['first', 'new']);
        store.unsubscribe('first');
        store.setData({n: 2, other: 2});
        expect(calls).toEqual(['first', 'new', 'new']);
        store.unsubscribe('target');
    });

    test('a same-ID replacement without unsubscribe is also skipped for the matched sync event', () => {
        const store = new Carburetor({n: 0, other: 0});
        const calls: string[] = [];
        store.subscribe(() => {
            calls.push('first');
            store.subscribe(() => calls.push('new'), {id: 'target', reads: readPath(store, 'other')});
        }, {id: 'first', reads: readPath(store, 'n')});
        store.subscribe(() => calls.push('old'), {id: 'target', reads: readPath(store, 'n')});
        store.setData({n: 1, other: 0});
        expect(calls).toEqual(['first']);
        store.unsubscribe('first');
        store.setData({n: 2, other: 1});
        expect(calls).toEqual(['first', 'new']);
        store.unsubscribe('target');
    });

    test('throwing sync subscriber does not prevent subsequent store-local or shared-store deliveries', () => {
        const scheduler = new ManualThrottle();
        const a = new Carburetor({n: 0});
        const b = new Carburetor({n: 0}, scheduler);
        const c = new Carburetor({n: 0}, scheduler);
        const calls: string[] = [];
        const errorSpy = rstest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            a.subscribe(() => { throw new Error('sync failure'); }, {id: 'view'});
            a.subscribe(() => calls.push('sync continues'), {id: 'after'});
            a.setData({n: 1});
            b.subscribe(() => { throw new Error('deferred failure'); }, {id: 'view'});
            c.subscribe(() => calls.push('throttle continues'), {id: 'view'});
            b.setData({n: 1});
            c.setData({n: 1});
            scheduler.flush();
            expect(calls).toEqual(['sync continues', 'throttle continues']);
        } finally {
            errorSpy.mockRestore();
        }
    });
});

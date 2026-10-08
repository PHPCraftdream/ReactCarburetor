import {Carburetor} from '@/Carburetor';
import {WriteLog} from '@/Carburetor/Store/Paths/WriteLog';
import {
    CARBURETOR_PATHS_SINCE, CARBURETOR_TARGETS_SINCE, CARBURETOR_TRACK_TARGETS, IInternalSubscriptionProtocol,
} from '@/Carburetor/Store/Utils/Models';

class Store extends Carburetor<{tick: number; rows: Array<{a: number}>}> {
    public change(fn: (draft: {tick: number; rows: Array<{a: number}>}) => void): void { this.update(fn); }
}

const protocol = (store: Store): IInternalSubscriptionProtocol => store as unknown as IInternalSubscriptionProtocol;

describe('write proofs are retained on demand (R39-04)', () => {
    test('a log created without tracking answers nothing until tracking starts, then only newer baselines', () => {
        const log = new WriteLog(undefined, false);
        const target = {};
        log.record(1, new Set(['a']), new Map([['a', new Set([target])]]));
        expect(log.pathsSince(0)).toBeUndefined();
        expect(log.targetsSince(0)).toBeUndefined();

        log.track(1);
        log.record(2, new Set(['b']), new Map([['b', new Set([target])]]));
        expect(log.pathsSince(1)).toEqual(['b']);
        expect(log.targetsSince(1)?.get('b')?.has(target)).toBe(true);
        expect(log.pathsSince(0)).toBeUndefined();
        expect(log.targetsSince(0)).toBeUndefined();
    });

    test('tracking started twice keeps its first boundary', () => {
        const log = new WriteLog(undefined, false);
        log.track(3);
        log.track(9);
        log.record(10, new Set(['a']), new Map([['a', new Set([{}])]]));
        expect(log.pathsSince(3)).toEqual(['a']);
    });

    test('a store keeps no proof until a consumer asks, and keeps it afterwards', () => {
        const store = new Store({tick: 0, rows: [{a: 0}]});
        store.change(d => { d.rows[0].a = 1; });
        const baseline = store.getVersion();
        store.change(d => { d.rows[0].a = 2; });
        expect(protocol(store)[CARBURETOR_PATHS_SINCE]?.call(store, baseline)).toBeUndefined();
        expect(protocol(store)[CARBURETOR_TARGETS_SINCE]?.call(store, baseline)).toBeUndefined();

        protocol(store)[CARBURETOR_TRACK_TARGETS]?.call(store);
        const tracked = store.getVersion();
        store.change(d => { d.rows[0].a = 3; });
        expect(protocol(store)[CARBURETOR_PATHS_SINCE]?.call(store, tracked)).toEqual(['rows.0.a']);
        expect(protocol(store)[CARBURETOR_TARGETS_SINCE]?.call(store, tracked)?.get('rows.0.a')?.size).toBe(1);
        expect(protocol(store)[CARBURETOR_PATHS_SINCE]?.call(store, baseline)).toBeUndefined();
    });

    test('creating an object-valued watch starts tracking before its first related write', () => {
        const store = new Store({tick: 0, rows: [{a: 0}]});
        const stop = store.watch(d => d.rows, () => undefined);
        const baseline = store.getVersion();
        store.change(d => { d.rows[0].a = 1; });
        expect(protocol(store)[CARBURETOR_PATHS_SINCE]?.call(store, baseline)).toEqual(['rows.0.a']);
        stop();
    });

    test('a primitive-valued watch never asks for proofs', () => {
        const store = new Store({tick: 0, rows: [{a: 0}]});
        const stop = store.watch(d => d.tick, () => undefined);
        const baseline = store.getVersion();
        store.change(d => { d.tick = 1; });
        expect(protocol(store)[CARBURETOR_PATHS_SINCE]?.call(store, baseline)).toBeUndefined();
        stop();
    });
});

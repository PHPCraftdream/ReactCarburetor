import {S} from "@/Carburetor/Store/Diagnostics/Internal/StoreIdentity";
import {WriteLog} from '@/Carburetor/Store/Paths/WriteLog';
import {WriteTargetLedger} from '@/Carburetor/Store/Utils/Graph/WriteTargetLedger';
import {acquire, internals, makeStore, targetsSince} from './support';

describe('nothing is retained once the last owner is gone (R39-04 release)', () => {
    test('release drops accumulated targets, recent paths and pending pairs', () => {
        const store = makeStore();
        const release = acquire(store);
        for (let n = 1; n <= 200; n++) store.change(d => { d.rows[0].a = n; d.other.b = n; });
        const live = internals(store);
        expect(live[S.writeLog].targets.paths.size).toBeGreaterThan(0);
        expect(live[S.writeLog].recent.entries.size).toBeGreaterThan(0);
        release();
        expect(live[S.writeLog].targets.paths.size).toBe(0);
        expect(live[S.writeLog].targets.count).toBe(0);
        expect(live[S.writeLog].recent.entries.size).toBe(0);
        expect(live[S.writeLog].trackedSince).toBe(Infinity);
        expect(live[S.writeTargets].pairs).toHaveLength(0);
        expect(live[S.writeTargets].enabled).toBe(false);
    });

    test('the consumer-visible proof is released too', () => {
        const store = makeStore();
        const release = acquire(store);
        const baseline = store.getVersion();
        store.change(d => { d.rows[0].a = 5; });
        expect(targetsSince(store, baseline)?.size).toBe(1);
        expect(internals(store)[S.writeLog].targets.paths.size).toBe(1);
        release();
        expect(internals(store)[S.writeLog].targets.paths.size).toBe(0);
        expect(targetsSince(store, baseline)).toBeUndefined();
    });

    test('a store written only after release retains no raw object', () => {
        const store = makeStore();
        acquire(store)();
        for (let n = 1; n <= 3000; n++) store.change(d => { d.rows[0].a = n; });
        expect(internals(store)[S.writeLog].targets.count).toBe(0);
        expect(internals(store)[S.writeLog].recent.entries.size).toBe(0);
        expect(internals(store)[S.writeTargets].pairs).toHaveLength(0);
    });

    test('WriteLog.untrack returns an explicitly tracked log to the untracked state', () => {
        const log = new WriteLog(undefined, false);
        log.track(0);
        log.record(1, new Set(['a']), [['a', {}]]);
        expect(log.pathsSince(0)).toEqual(['a']);
        log.untrack();
        expect(log.pathsSince(0)).toBeUndefined();
        expect(log.targetsSince(0)).toBeUndefined();
        log.record(2, new Set(['b']), [['b', {}]]);
        expect((log as unknown as {targets: {count: number}}).targets.count).toBe(0);
        log.track(2);
        log.record(3, new Set(['c']), [['c', {}]]);
        expect(log.pathsSince(1)).toBeUndefined();
        expect(log.pathsSince(2)).toEqual(['c']);
    });

    test('a disabled ledger releases pending pairs and reports the loss when re-enabled', () => {
        const ledger = new WriteTargetLedger(true);
        const buffer = ledger.entries;
        ledger.add('a', {});
        ledger.disable();
        expect(buffer).toHaveLength(0);
        ledger.add('b', {});
        expect(buffer).toHaveLength(0);
        ledger.enable();
        expect(ledger.isIncomplete).toBe(true);
        ledger.reset();
        expect(ledger.isIncomplete).toBe(false);
        ledger.add('c', {});
        expect(buffer).toHaveLength(1);
    });
});

import {S} from "@/Carburetor/Store/Diagnostics/Internal/StoreIdentity";
import {Carburetor, ComponentUpdateThrottle, computed, transaction} from '@/Carburetor';
import {CARBURETOR_EXTEND, CARBURETOR_HAS_DRIFT} from '@/Carburetor/Store/Utils/Models';
import {WriteLog} from '@/Carburetor/Store/Paths/WriteLog';
import {TPath} from '@/Carburetor/Models/Paths';

class Store extends Carburetor<{left: number; right: number; count: number}> {
    public writeLeft = (): void => this.update(draft => { draft.left++; });
    public writeRight = (): void => this.update(draft => { draft.right++; });
    public run = (fn: (draft: {count: number}) => void): void => this.update(fn);
}

class CountingStore extends Store {
    public matches = 0;
    public matchesCalls = 0;
    constructor(state: {left: number; right: number; count: number; draft: string}) {
        super(state);
        // Count the write-log consultations the fast path is supposed to spare: a subclass
        // view over the same log instance, so record/watermark stay shared.
        const log = this[S.writeLog];
        const proxy: WriteLog = Object.create(log);
        proxy.matches = (baseline: number, reads: ReadonlySet<TPath>): boolean => {
            this.matchesCalls++;
            return log.matches(baseline, reads);
        };
        this[S.writeLog] = proxy;
    }
    public override [CARBURETOR_HAS_DRIFT](baseline: number, reads: ReadonlySet<TPath>): boolean {
        this.matches++;
        return super[CARBURETOR_HAS_DRIFT](baseline, reads);
    }
}

class ControlledThrottle extends ComponentUpdateThrottle {
    public flush = (): void => this.letsUpdate();
}

describe('observed computed store drift shortcuts', () => {
    test('a write between render and subscribe remains drift', () => {
        const store = new Store({left: 0, right: 0});
        const value = computed(read => read(store).left);
        const initial = value.get();
        store.writeLeft();
        const id = value.subscribe(() => undefined);
        expect(value.get()).toBe(initial + 1);
        value.unsubscribe(id);
    });

    test('a write in an open transaction remains drift before notification', () => {
        const store = new Store({left: 0, right: 0});
        const value = computed(read => read(store).left);
        const id = value.subscribe(() => undefined);
        expect(value.get()).toBe(0);
        const baseline = store.getVersion();
        transaction(() => {
            store.writeLeft();
            expect(store.getVersion()).toBeGreaterThan(baseline);
            expect(value.get()).toBe(1);
        });
        expect(value.get()).toBe(1);
        value.unsubscribe(id);
    });

    test('a matching write remains drift', () => {
        const store = new Store({left: 0, right: 0});
        const baseline = store.getVersion();
        const value = computed(read => read(store).left);
        const id = value.subscribe(() => undefined);
        expect(value.get()).toBe(0);
        const subscribedBaseline = store.getVersion();
        expect(subscribedBaseline).toBeGreaterThanOrEqual(baseline);
        store.writeLeft();
        expect(value.get()).toBe(1);
        value.unsubscribe(id);
    });

    test('an unrelated write answers without rematching the read set', () => {
        const store = new CountingStore({left: 0, right: 0, draft: ''});
        const value = computed(read => read(store).left);
        const id = value.subscribe(() => undefined);
        expect(value.get()).toBe(0);
        const matchesAfterSubscribe = store.matches;
        store.writeRight();
        expect(store.matches).toBe(matchesAfterSubscribe);
        // The fast path must answer the foreign write without consulting the write log,
        // both at the write and on the freshness check of the next get().
        expect(value.get()).toBe(0);
        expect(store.matches).toBe(matchesAfterSubscribe + 1);
        expect(store.matchesCalls).toBe(0);
        value.unsubscribe(id);
    });

    test('subscription growth falls back to precise write-log matching', () => {
        const store = new Store({left: 0, right: 0});
        const reads = new Set<TPath>(['left']);
        store.subscribe(() => undefined, {id: 'growth', reads});
        const baseline = store.getVersion();
        store.writeRight();
        store[CARBURETOR_EXTEND]('growth', 'right');
        expect(store[CARBURETOR_HAS_DRIFT](baseline, reads)).toBe(false);
        store.unsubscribe('growth');
    });

    test('replacing a subscription id cannot use its previous read set record', () => {
        const store = new Store({left: 0, right: 0});
        const previousReads = new Set<TPath>(['left']);
        const currentReads = new Set<TPath>(['right']);
        store.subscribe(() => undefined, {id: 'same', reads: previousReads});
        store.subscribe(() => undefined, {id: 'same', reads: currentReads});
        const baseline = store.getVersion();
        store.writeRight();
        expect(store[CARBURETOR_HAS_DRIFT](baseline, previousReads)).toBe(false);
        expect(store[CARBURETOR_HAS_DRIFT](baseline, currentReads)).toBe(true);
        store.unsubscribe('same');
    });

    test('throttled notification still detects a matching write', () => {
        const scheduler = new ControlledThrottle(100000);
        expect(scheduler).toBeInstanceOf(ComponentUpdateThrottle);
        const store = new Store({left: 0, right: 0, draft: ''}, scheduler);
        const value = computed(read => read(store).left);
        const id = value.subscribe(() => undefined);
        expect(value.get()).toBe(0);
        store.writeLeft();
        expect(value.get()).toBe(1);
        scheduler.flush();
        value.unsubscribe(id);
    });
});

describe('reentrant reads during notification', () => {
    test('a subscriber callback that reads a computed observes the fresh count', () => {
        const store = new Store({left: 0, right: 0, count: 0});
        const c = computed(read => read(store).count);
        let seen: number | undefined;
        store.subscribe(() => { seen = c.get(); });
        const sub = c.subscribe(() => undefined);
        expect(c.get()).toBe(0);
        store.run(d => { d.count++; });
        expect(seen).toBe(1);
        expect(c.get()).toBe(1);
        // Second write: the computed's cache now sits at the previous event's version, and the
        // wildcard subscriber is matched before the computed's own record — the pre-fix ordering
        // scheduled the wildcard callback while the computed's matchedVersion was still stale,
        // so the drift shortcut answered "no drift" and the callback read the stale count.
        store.run(d => { d.count++; });
        expect(seen).toBe(2);
        expect(c.get()).toBe(2);
        store.unsubscribe(sub);
    });
});

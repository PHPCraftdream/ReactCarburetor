import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {Carburetor, ComponentUpdateThrottle, computed, transaction} from '@/Carburetor';
import {CARBURETOR_HAS_DRIFT} from '@/Carburetor/Store/Utils/Models';
import {useCarburetorValue} from '@/Interop';
import {WriteLog} from '@/Carburetor/Store/Paths/WriteLog';
import {captureLeafVersions} from '@/Carburetor/Derived/Freshness/captureLeafVersions';
import {computedDependencies} from '@/Carburetor/Derived/computedDependencies';
import {IReadSet} from '@/Carburetor/Derived/Freshness/Models';
import {TPath} from '@/Carburetor/Models/Paths';

interface ISideData {
    left: number;
    right: number;
    mid?: number;
}

class CountingStore extends Carburetor<ISideData> {
    public matches = 0;
    public matchesCalls = 0;
    /** Consultations whose reads overlap the inner computed's retained set. */
    public innerSetCalls = 0;
    constructor(state: ISideData & {draft?: string}) {
        super(state);
        // Count the write-log consultations the filed read set is supposed to spare.
        const log = this.writeLog;
        const proxy: WriteLog = Object.create(log);
        proxy.matches = (baseline: number, reads: ReadonlySet<TPath>): boolean => {
            this.matchesCalls++;
            for (const path of reads) {
                if (path.startsWith('items')) {
                    this.innerSetCalls++;
                    break;
                }
            }
            return log.matches(baseline, reads);
        };
        this.writeLog = proxy;
    }
    public override [CARBURETOR_HAS_DRIFT](baseline: number, reads: ReadonlySet<TPath>): boolean {
        this.matches++;
        return super[CARBURETOR_HAS_DRIFT](baseline, reads);
    }
}

class ControlledThrottle extends ComponentUpdateThrottle {
    public flush = (): void => this.letsUpdate();
}

describe('retained recompute identity (R34)', () => {
    test('retained recompute keeps the filed read set identity', () => {
        const store = new CountingStore({left: 0, right: 0});
        const value = computed(read => read(store).left);
        const id = value.subscribe(() => undefined);
        expect(value.get()).toBe(0);
        // A write to the read path forces a recompute that keeps the read set instead of refiling it.
        store.update(d => { d.left = 5; });
        expect(value.get()).toBe(5);

        const before = store.matchesCalls;
        store.update(d => { d.right++; });
        expect(value.get()).toBe(5);
        // THE COUNTER ASSERTION: the unrelated write must be answered by the retained filed
        // set, never by consulting the write log.
        expect(store.matchesCalls).toBe(before);

        // Drift is still detected on the retained set.
        store.update(d => { d.left = 5; });
        expect(value.get()).toBe(5);
        value.unsubscribe(id);
    });

    test('fan-in keeps per-constituent filed sets', () => {
        const store = new CountingStore({left: 0, right: 0, items: [1, 2, 3], noise: 0} as ISideData);
        const open = computed(read => read(store).items.length);
        const share = computed(read => read(open) * 2 + read(store).noise * 0);
        const openId = open.subscribe(() => undefined);
        const shareId = share.subscribe(() => undefined);
        expect(share.get()).toBe(6);

        const before = store.matchesCalls;
        store.update(d => { d.noise++; });
        expect(share.get()).toBe(6);
        // The direct noise read is genuinely concerned: exactly one precise consultation,
        // answered by the write log itself.
        expect(store.matchesCalls).toBe(before + 1);
        // THE COUNTER ASSERTION: the retained per-constituent inner set must answer its part
        // without ever falling back to the write log.
        expect(store.innerSetCalls).toBe(0);

        store.update(d => { d.items.push(4); });
        expect(share.get()).toBe(8);
        share.unsubscribe(shareId);
        open.unsubscribe(openId);
    });

    test('a third fan-in dependency keeps the earlier constituents', () => {
        // The third inner computed fans into an already-merged leaf: dropping previous.parts
        // would hide writes to the first two constituents' paths.
        const store = new CountingStore({left: 0, right: 0, mid: 0});
        const first = computed(read => read(store).left);
        const second = computed(read => read(store).right);
        const third = computed(read => read(store).mid ?? 0);
        const total = computed(read => read(first) + read(second) + read(third));
        const totalId = total.subscribe(() => undefined);
        expect(total.get()).toBe(0);

        store.update(d => { d.left = 1; });
        expect(total.get()).toBe(1);
        store.update(d => { d.right = 2; });
        expect(total.get()).toBe(3);
        store.update(d => { d.mid = 4; });
        expect(total.get()).toBe(7);
        total.unsubscribe(totalId);
    });

    test('a nested fan-in into an already-merged leaf keeps every constituent', () => {
        // Stand-ins for inner computeds, so the capture merges their flattened leaves.
        const makeFakeSource = (id: string): {getUID: () => string} => ({getUID: () => id});
        const storeSource = makeFakeSource('store-n') as unknown as IReadSet['source'];
        const inner = ['x', 'y', 'z'].map(path => {
            const source = makeFakeSource('c-' + path) as unknown as IReadSet['source'];
            computedDependencies.versions.set(source, () => ({
                '0': {source: storeSource, version: 0, reads: new Set<TPath>([path])},
            }));

            return source;
        });
        const versions = {};

        captureLeafVersions(Object.fromEntries(inner.map((source, n) => ['d' + n,
            {source, reads: new Set<TPath>(['c' + n])}] as const)), versions);

        const merged = versions[':store-n'];
        // THE COUNTER ASSERTION: the third constituent fans into an already-merged leaf; the
        // merge must extend parts instead of overwriting them with the bare leaf record.
        expect(merged.parts).toBeDefined();
        expect(merged.parts!.length).toEqual(3);
        expect([...(merged.parts![0].reads as Set<TPath>)]).toEqual(['x']);
        expect([...(merged.parts![2].reads as Set<TPath>)]).toEqual(['z']);
    });

    test('a hook cache adopts the filed read set after a related edit', () => {
        interface IRowData {
            rows: {id: number; title: string}[];
            noise: number;
        }
        class RowStore extends Carburetor<IRowData> {
            public matches = 0;
            public matchesCalls = 0;
            constructor(state: IRowData & {draft?: string}) {
                super(state);
                const log = this.writeLog;
                const proxy: WriteLog = Object.create(log);
                proxy.matches = (baseline: number, reads: ReadonlySet<TPath>): boolean => {
                    this.matchesCalls++;
                    return log.matches(baseline, reads);
                };
                this.writeLog = proxy;
            }
            public override [CARBURETOR_HAS_DRIFT](baseline: number, reads: ReadonlySet<TPath>): boolean {
                this.matches++;
                return super[CARBURETOR_HAS_DRIFT](baseline, reads);
            }
        }

        const store = new RowStore({
            rows: [
                {id: 0, title: 'zero'},
                {id: 1, title: 'one'},
                {id: 2, title: 'two'},
            ],
            noise: 0,
        });
        let bump: () => void = () => undefined;
        const View = () => {
            const rows = useCarburetorValue(store, d => d.rows);
            const [tick, setTick] = React.useState(0);
            React.useEffect(() => { bump = () => setTick((n: number) => n + 1); });
            return <ul><li>{rows[1].title}:{tick}</li></ul>;
        };
        const view = render(<View/>);
        expect(view.container.querySelector('li')?.textContent).toEqual('one:0');

        // Related edit: the hook re-reads and refiles its read set at the new version.
        void act(() => store.update(d => { d.rows[1].title = 'edited'; }));
        expect(view.container.querySelector('li')?.textContent).toEqual('edited:0');

        const before = store.matchesCalls;
        void act(() => store.update(d => { d.noise++; }));
        // Force getSnapshot at the moved version through a state bump.
        act(() => bump());
        expect(view.container.querySelector('li')?.textContent).toEqual('edited:1');
        // THE COUNTER ASSERTION: the adopted filed set answers without write-log matching.
        expect(store.matchesCalls).toBe(before);
        view.unmount();
    });

    test('a matching write remains drift after a retained recompute', () => {
        const store = new CountingStore({left: 0, right: 0});
        const value = computed(read => read(store).left);
        const id = value.subscribe(() => undefined);
        expect(value.get()).toBe(0);
        store.update(d => { d.left = 0; });
        expect(value.get()).toBe(0);
        store.update(d => { d.left = 7; });
        expect(value.get()).toBe(7);
        value.unsubscribe(id);
    });

    test('an open transaction still surfaces a matching write after a retained recompute', () => {
        const store = new CountingStore({left: 0, right: 0});
        const value = computed(read => read(store).left);
        const id = value.subscribe(() => undefined);
        expect(value.get()).toBe(0);
        store.update(d => { d.left = 0; });
        expect(value.get()).toBe(0);
        transaction(() => {
            store.update(d => { d.left = 9; });
            // Inside the transaction the computed already reads the fresh value.
            expect(value.get()).toBe(9);
        });
        expect(value.get()).toBe(9);
        value.unsubscribe(id);
    });

    test('a throttled notification still delivers a matching write after a retained recompute', () => {
        const scheduler = new ControlledThrottle(100000);
        const store = new CountingStore({left: 0, right: 0}, scheduler);
        const value = computed(read => read(store).left);
        const id = value.subscribe(() => undefined);
        expect(value.get()).toBe(0);
        store.update(d => { d.left = 0; });
        expect(value.get()).toBe(0);
        store.update(d => { d.left = 4; });
        expect(value.get()).toBe(4);
        scheduler.flush();
        value.unsubscribe(id);
    });
});

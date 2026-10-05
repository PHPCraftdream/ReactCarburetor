/* oxlint-disable carburetor/no-untrackable-store-data, carburetor/no-untrackable-draft-mutation */
import * as React from 'react';
import {act, Profiler, useLayoutEffect} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, Carburetor, ComponentUpdateThrottle, computed, transaction} from '@/Carburetor';
import type {ICarburetorSubscription} from '@/Carburetor';
import {useComputedValue} from '@/Interop';
import {CARBURETOR_SNAPSHOT_VERSION, IInternalSubscriptionProtocol} from '@/Carburetor/Store/Utils/Models';

class Source extends Carburetor<{
    index: Map<string, number>; tags: Set<string>; stamp: Date; count: number; other: number;
}> {
    constructor(scheduler?: ComponentUpdateThrottle) {
        super({index: new Map([['a', 1]]), tags: new Set(['a']), stamp: new Date(1000), count: 1, other: 0}, scheduler);
    }

    public change = (): void => this.update(draft => {
        draft.index.set('a', 2);
        draft.tags.add('b');
        draft.stamp.setTime(2000);
        draft.count = 2;
    });
    public changeCount = (count: number): void => this.update(draft => { draft.count = count; });
    public changeOther = (): void => this.update(draft => { draft.other++; });
}

class PrototypeVersionSource extends Source {
    private revision = 0;
    public override getVersion(): number { return super.getVersion() + this.revision; }
    public moveWithoutEmit(): void {
        // Intentionally emulate an adapter whose public version moves without native delivery.
        // oxlint-disable-next-line carburetor/no-external-data-mutation
        this.getData().count = 4;
        this.revision++;
    }
}

class FieldVersionSource extends Source {
    private revision = 0;
    constructor() {
        super();
        Object.defineProperty(this, 'getVersion', {
            value: () => super.getVersion() + this.revision, configurable: true,
        });
    }
    public moveWithoutEmit(): void {
        // Intentionally emulate an adapter whose public version moves without native delivery.
        // oxlint-disable-next-line carburetor/no-external-data-mutation
        this.getData().count = 4;
        this.revision++;
    }
}

class ControlledThrottle extends ComponentUpdateThrottle {
    public flush = (): void => this.letsUpdate();
}

/**
 * Reads the snapshot version through the R33-08 symbol protocol instead of the removed public
 * getter.
 *
 * @param source - the computed source whose snapshot version is checked
 */
const snapshotVersion = (source: ICarburetorSubscription): number =>
    (source as IInternalSubscriptionProtocol)[CARBURETOR_SNAPSHOT_VERSION]!();

describe('computed freshness across observation and deferred delivery', () => {
    test.each(['map', 'envelope', 'set', 'date'] as const)(
        'a %s rendered before the first subscription is rechecked after a sibling layout write', kind => {
            const store = new Source();
            const envelope = {index: store.getData().index};
            const source = computed(read => {
                const state = read(store);
                if (kind === 'map') return state.index;
                if (kind === 'set') return state.tags;
                if (kind === 'date') return state.stamp;
                void state.index;
                return envelope;
            });
            let commits = 0;
            let renders = 0;
            const View = () => {
                renders++;
                const value = useComputedValue(source);
                const shown = value instanceof Map ? value.get('a') : value instanceof Set ? value.size
                    : value instanceof Date ? value.getTime() : value.index.get('a');
                return <span>{shown}</span>;
            };
            const Write = () => { useLayoutEffect(() => { store.change(); }, []); return null; };
            const {container, unmount} = render(<><Profiler id="computed" onRender={() => { commits++; }}>
                <View/>
            </Profiler><Write/></>);
            expect(container.textContent).toBe(kind === 'date' ? '2000' : '2');
            expect(commits).toBe(2);
            expect(renders).toBe(2);
            expect(source.getVersion()).toBe(0);
            expect(snapshotVersion(source)).toBe(1);
            unmount();
            expect(source['subscribers'].size).toBe(0);
        }
    );

    test('an equal primitive write before observation reuses the snapshot and does not rerender', () => {
        const store = new Source();
        const source = computed(read => Math.min(read(store).count, 1));
        let renders = 0;
        const View = () => { renders++; return <span>{useComputedValue(source)}</span>; };
        const Write = () => { useLayoutEffect(() => { store.change(); }, []); return null; };
        const {container, unmount} = render(<><View/><Write/></>);
        expect(container.textContent).toBe('1');
        expect(renders).toBe(1);
        expect(source.getVersion()).toBe(0);
        expect(snapshotVersion(source)).toBe(0);
        unmount();
    });

    test('switching native hook sources with equal values transfers the observer', () => {
        const first = new Source();
        const second = new Source();
        const a = computed(read => read(first).count);
        const b = computed(read => read(second).count);
        const View = ({source}: {source: typeof a}) => <span>{useComputedValue(source)}</span>;
        const {container, rerender, unmount} = render(<View source={a}/>);
        rerender(<View source={b}/>);
        act(() => second.changeCount(3));
        expect(container.textContent).toBe('3');
        expect(a['subscribers'].size).toBe(0);
        unmount();
        expect(b['subscribers'].size).toBe(0);
    });

    test('an unrelated unobserved write leaves an exotic snapshot token and body untouched', () => {
        const store = new Source();
        let runs = 0;
        const source = computed(read => { runs++; return read(store).index; });
        const initial = source.get();
        store.changeOther();
        expect(source.get()).toBe(initial);
        expect(runs).toBe(1);
        expect(snapshotVersion(source)).toBe(0);
    });

    test.each([
        ['prototype', () => new PrototypeVersionSource()],
        ['class field', () => new FieldVersionSource()],
    ] as const)('a %s store version adapter is checked even without a native write epoch', (_kind, make) => {
        const store = make();
        const source = computed(read => read(store).count * 2);
        const seen: number[] = [];
        const subscription = source.subscribe(() => seen.push(source.get()));
        expect(source.get()).toBe(2);
        store.moveWithoutEmit();
        expect(source.get()).toBe(8);
        expect(seen).toEqual([]);
        store.changeCount(5);
        expect(seen).toEqual([10]);
        source.unsubscribe(subscription);
    });

    test('a class bridge notices an in-place change before its first subscription', () => {
        const store = new Source();
        const source = computed(read => read(store).index);
        let renders = 0;
        class View extends AntiHookComponent {
            render() { renders++; return <span>{this.useComputed(source).get('a')}</span>; }
        }
        const Write = () => { useLayoutEffect(() => { store.change(); }, []); return null; };
        const {container, unmount} = render(<><Write/><View/></>);
        expect(container.textContent).toBe('2');
        expect(renders).toBe(2);
        expect(source.getVersion()).toBe(0);
        unmount();
        expect(source['subscribers'].size).toBe(0);
    });

    test('a class source switch retains the new subscription even for equal primitives', () => {
        const first = new Source();
        const second = new Source();
        const a = computed(read => read(first).count);
        const b = computed(read => read(second).count);
        class View extends AntiHookComponent<{source: typeof a}> {
            render() { return <span>{this.useComputed(this.props.source)}</span>; }
        }
        const {container, rerender, unmount} = render(<View source={a}/>);
        rerender(<View source={b}/>);
        act(() => second.changeCount(3));
        expect(container.textContent).toBe('3');
        expect(a['subscribers'].size).toBe(0);
        unmount();
        expect(b['subscribers'].size).toBe(0);
    });

    test('a deferred equal primitive stays unpublished after an eager read', () => {
        const store = new Source();
        let evaluations = 0;
        const source = computed(read => {
            evaluations++;
            return Math.min(read(store).count, 1);
        });
        let announcements = 0;
        const subscription = source.subscribe(() => { announcements++; });
        transaction(() => {
            store.changeCount(2);
            expect(source.get()).toBe(1);
        });
        expect(evaluations).toBe(2);
        expect(announcements).toBe(0);
        expect(source.getVersion()).toBe(0);
        source.unsubscribe(subscription);
    });

    test.each(['transaction', 'throttle'] as const)(
        'pulls observed direct, chain and diamond values during a %s without consuming publication', mode => {
            const scheduler = new ControlledThrottle(100000);
            const store = new Source(mode === 'throttle' ? scheduler : undefined);
            const runs = [0, 0, 0];
            const doubled = computed(read => { runs[0]++; return read(store).count * 2; });
            const chain = computed(read => { runs[1]++; return read(doubled) + 1; });
            const diamond = computed(read => { runs[2]++; return read(doubled) + read(store).count; });
            const unobserved = computed(read => read(store).count + 10);
            const received: number[][] = [[], [], []];
            const doubledSubscription = doubled.subscribe(() => received[0].push(doubled.get()));
            const chainSubscription = chain.subscribe(() => received[1].push(chain.get()));
            const diamondSubscription = diamond.subscribe(() => received[2].push(diamond.get()));
            expect(runs).toEqual([1, 1, 1]);
            const check = () => {
                store.changeCount(2);
                expect([doubled.get(), chain.get(), diamond.get(), unobserved.get()]).toEqual([4, 5, 6, 12]);
                expect(received).toEqual([[], [], []]);
                expect(runs).toEqual([2, 2, 2]);
                // An unrelated path moves the store version, but cannot re-evaluate a body.
                store.changeOther();
                expect([doubled.get(), chain.get(), diamond.get()]).toEqual([4, 5, 6]);
                expect(received).toEqual([[], [], []]);
                expect(runs).toEqual([2, 2, 2]);
            };
            if (mode === 'transaction') transaction(check);
            else { check(); scheduler.flush(); }
            expect(received).toEqual([[4], [5], [6]]);
            expect([doubled.getVersion(), chain.getVersion(), diamond.getVersion()]).toEqual([1, 1, 1]);
            expect(runs).toEqual([2, 2, 2]);
            diamond.unsubscribe(diamondSubscription);
            chain.unsubscribe(chainSubscription);
            doubled.unsubscribe(doubledSubscription);
        }
    );

    test('flattened diamond paths retain both direct and derived inputs during a deferred batch', () => {
        const store = new Source();
        const runs = [0, 0];
        const inner = computed(read => { runs[0]++; return read(store).count; });
        const diamond = computed(read => {
            runs[1]++;
            return read(inner) * 2 + read(store).other;
        });
        const published: number[] = [];
        const subscription = diamond.subscribe(() => published.push(diamond.get()));
        expect(runs).toEqual([1, 1]);
        transaction(() => {
            store.changeCount(2);
            expect(diamond.get()).toBe(4);
            expect(runs).toEqual([2, 2]);
            store.changeOther();
            expect(diamond.get()).toBe(5);
            expect(runs).toEqual([2, 3]);
            expect(published).toEqual([]);
        });
        expect(published).toEqual([5]);
        expect(diamond.getVersion()).toBe(1);
        diamond.unsubscribe(subscription);
    });

    test('a deferred failing read propagates its error and later publishes only the recovered value', () => {
        const store = new Source();
        const failure = new Error('invalid count');
        const source = computed(read => {
            const value = read(store).count;
            if (value === 2) throw failure;
            return value;
        });
        const published: number[] = [];
        const subscription = source.subscribe(() => published.push(source.get()));
        const report = rstest.spyOn(console, 'error').mockImplementation(() => {});
        let caught: unknown;
        try {
            transaction(() => {
                store.changeCount(2);
                try { source.get(); } catch (error: unknown) { caught = error; }
            });
            expect(report).toHaveBeenCalledTimes(1);
        } finally {
            report.mockRestore();
        }
        expect(caught).toBe(failure);
        expect(source.getVersion()).toBe(0);
        expect(published).toEqual([]);
        store.changeCount(3);
        expect(source.get()).toBe(3);
        expect(source.getVersion()).toBe(1);
        expect(published).toEqual([3]);
        source.unsubscribe(subscription);
    });
});

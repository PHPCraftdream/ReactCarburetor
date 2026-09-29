// Exotic mutations exercise publication snapshots.
/* oxlint-disable carburetor/no-untrackable-store-data, carburetor/no-untrackable-draft-mutation */
import * as React from 'react';
import {act, Profiler, StrictMode, useLayoutEffect} from 'react';
import {render} from '@testing-library/react';
import {Carburetor, computed, IComputed} from '@/Carburetor';
import {useComputedValue} from '@/Interop';

class ExoticStore extends Carburetor<{
    index: Map<string, number>;
    tags: Set<string>;
    stamp: Date;
    count: number;
}> {
    public constructor() {
        super({index: new Map([['a', 1]]), tags: new Set(['a']), stamp: new Date(1000), count: 1});
    }

    public mutate = (): void => {
        this.update(draft => {
            draft.index.set('a', 2);
            draft.tags.add('b');
            draft.stamp.setTime(2000);
        });
    };

    public increment = (): void => {
        this.update(draft => { draft.count++; });
    };
}

class ExternalComputed<R> implements IComputed<R> {
    public callbacks = new Map<string, () => void>();
    public version = 0;
    public reads = 0;
    public pending: (() => void) | undefined;
    private nextId = 0;

    public constructor(public value: R) {}
    public getUID = (): string => 'external';
    public getVersion = (): number => this.version;
    public get = (): R => {
        this.reads++;
        const pending = this.pending;
        this.pending = undefined;
        pending?.();

        return this.value;
    };
    public subscribe = (callback: () => void): string => {
        const id = String(this.nextId++);
        this.callbacks.set(id, callback);

        return id;
    };
    public unsubscribe = (id: string): void => { this.callbacks.delete(id); };
    public deliver = (): void => { this.callbacks.forEach(callback => callback()); };
    public publish = (): void => { this.version++; this.deliver(); };
}

describe('computed hook publication snapshots (R10-03)', () => {
    test('a delivered in-place Map change updates the DOM and preserves the live value', () => {
        const store = new ExoticStore();
        const source = computed(read => read(store).index);
        const seen: Array<ReadonlyMap<string, number>> = [];
        let deliveries = 0;
        const id = source.subscribe(() => { deliveries++; });
        const View = () => {
            const value = useComputedValue(source);
            seen.push(value);

            return <div>{value.get('a')}</div>;
        };
        const {container, unmount} = render(<View/>);
        const initial = seen[0];
        const version = source.getVersion();

        act(store.mutate);

        expect(container.textContent).toBe('2');
        expect(deliveries).toBe(1);
        expect(source.getVersion()).toBe(version + 1);
        expect(seen).toHaveLength(2);
        expect(seen[1]).toBe(initial);
        expect(initial.get('a')).toBe(2);
        unmount();
        source.unsubscribe(id);
    });

    test('a stable envelope receives its Map publication', () => {
        const store = new ExoticStore();
        const envelope = {index: store.getData().index};
        const source = computed(read => {
            void read(store).index;

            return envelope;
        });
        const seen: Array<typeof envelope> = [];
        const View = () => {
            const value = useComputedValue(source);
            seen.push(value);

            return <div>{value.index.get('a')}</div>;
        };
        const {container, unmount} = render(<View/>);

        act(store.mutate);

        expect(container.textContent).toBe('2');
        expect(seen).toEqual([envelope, envelope]);
        expect(source.getVersion()).toBe(1);
        unmount();
    });

    test('Set and Date publications update their rendered contents', () => {
        const store = new ExoticStore();
        const tags = computed(read => read(store).tags);
        const stamp = computed(read => read(store).stamp);
        const View = () => <div>{useComputedValue(tags).size}:{useComputedValue(stamp).getTime()}</div>;
        const {container, unmount} = render(<View/>);

        act(store.mutate);

        expect(container.textContent).toBe('2:2000');
        expect(tags.getVersion()).toBe(1);
        expect(stamp.getVersion()).toBe(1);
        unmount();
    });

    test('equal primitive results publish nothing and render nothing', () => {
        const store = new ExoticStore();
        const source = computed(read => Math.min(read(store).count, 1));
        let renders = 0;
        const View = () => {
            renders++;

            return <div>{useComputedValue(source)}</div>;
        };
        const {container, unmount} = render(<View/>);
        const mounted = renders;

        act(store.increment);

        expect(container.textContent).toBe('1');
        expect(source.getVersion()).toBe(0);
        expect(renders).toBe(mounted);
        unmount();
    });

    test('unchanged snapshot checks reuse their record, including duplicate delivery', () => {
        const source = new ExternalComputed({count: 1});
        let renders = 0;
        let commits = 0;
        const View = () => {
            renders++;

            return <div>{useComputedValue(source).count}</div>;
        };
        const {unmount} = render(<Profiler id="value" onRender={() => { commits++; }}><View/></Profiler>);
        const mounted = renders;
        const reads = source.reads;

        act(() => { source.deliver(); source.deliver(); source.deliver(); });

        expect(source.reads).toBeGreaterThan(reads);
        expect(renders).toBe(mounted);
        expect(commits).toBe(1);
        unmount();
        expect(source.callbacks.size).toBe(0);
    });

    test('an external version publication is observable even with an equal primitive', () => {
        const source = new ExternalComputed(1);
        let commits = 0;
        const View = () => <div>{useComputedValue(source)}</div>;
        const {container, unmount} = render(
            <Profiler id="value" onRender={() => { commits++; }}><View/></Profiler>
        );

        act(source.publish);

        expect(container.textContent).toBe('1');
        expect(commits).toBe(2);
        unmount();
    });

    test('a lazy get reads the new version before constructing the snapshot', () => {
        const source = new ExternalComputed(1);
        let commits = 0;
        const View = () => <div>{useComputedValue(source)}</div>;
        const {container, unmount} = render(
            <Profiler id="value" onRender={() => { commits++; }}><View/></Profiler>
        );
        source.pending = () => { source.value = 2; source.version++; };

        act(source.deliver);

        expect(container.textContent).toBe('2');
        expect(commits).toBe(2);
        act(source.deliver);
        expect(commits).toBe(2);
        unmount();
    });

    test('a changed value without a changed version is still rechecked', () => {
        const source = new ExternalComputed(1);
        const View = () => <div>{useComputedValue(source)}</div>;
        const {container, unmount} = render(<View/>);
        source.value = 2;

        act(source.deliver);

        expect(container.textContent).toBe('2');
        expect(source.version).toBe(0);
        unmount();
    });

    test('source switches cannot reuse a callback cache from another source', () => {
        const first = new ExternalComputed(new Map([['a', 1]]));
        const second = new ExternalComputed(new Map([['a', 10]]));
        const View = ({source}: {source: IComputed<Map<string, number>>}) =>
            <div>{useComputedValue(source).get('a')}</div>;
        const {container, rerender, unmount} = render(<View source={first}/>);
        const obsolete = [...first.callbacks.values()][0];

        rerender(<View source={second}/>);
        expect(container.textContent).toBe('10');
        expect(first.callbacks.size).toBe(0);
        expect(second.callbacks.size).toBe(1);
        act(() => { first.value.set('a', 2); first.publish(); obsolete(); });
        expect(container.textContent).toBe('10');
        act(() => { second.value.set('a', 11); second.publish(); });
        expect(container.textContent).toBe('11');
        unmount();
        expect(second.callbacks.size).toBe(0);
    });

    test('equal source values and versions still install the new source subscription', () => {
        const first = new ExternalComputed(1);
        const second = new ExternalComputed(1);
        const View = ({source}: {source: IComputed<number>}) => <div>{useComputedValue(source)}</div>;
        const {container, rerender, unmount} = render(<View source={first}/>);

        rerender(<View source={second}/>);
        expect(first.callbacks.size).toBe(0);
        act(() => { second.value = 2; second.publish(); });
        expect(container.textContent).toBe('2');
        unmount();
        expect(second.callbacks.size).toBe(0);
    });

    test('a StrictMode subscription remount keeps one observer and cleans it up', () => {
        const source = new ExternalComputed(new Map([['a', 1]]));
        const View = () => <div>{useComputedValue(source).get('a')}</div>;
        const {container, unmount} = render(<StrictMode><View/></StrictMode>);

        expect(source.callbacks.size).toBe(1);
        act(() => { source.value.set('a', 2); source.publish(); });
        expect(container.textContent).toBe('2');
        unmount();
        expect(source.callbacks.size).toBe(0);
    });

    test('an initial commit write is caught when its recomputed value changes identity', () => {
        const store = new ExoticStore();
        const source = computed(read => read(store).count);
        const View = () => {
            const value = useComputedValue(source);

            return <div>{value}</div>;
        };
        const Write = () => { useLayoutEffect(() => { store.increment(); }, []); return null; };
        const {container, unmount} = render(<><View/><Write/></>);

        expect(container.textContent).toBe('2');
        unmount();
    });
});

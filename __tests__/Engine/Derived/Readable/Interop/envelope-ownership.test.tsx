import * as React from 'react';
import {act, Profiler, StrictMode, Suspense, startTransition} from 'react';
import {render} from '@testing-library/react';
import {renderToString} from 'react-dom/server';
import {Carburetor, computed, IComputed} from '@/Carburetor';
import {useComputedValue} from '@/Interop';

class External implements IComputed<{n: number}> {
    public version = 0;
    public value = {n: 1};
    public callbacks = new Map<string, () => void>();
    public pending: (() => void) | undefined;
    private next = 0;
    public getUID(): string { return 'external44'; }
    public getVersion(): number { return this.version; }
    public get(): {n: number} {
        const pending = this.pending; this.pending = undefined; pending?.();
        return this.value;
    }
    public subscribe(fn: () => void): string {
        const id = String(++this.next); this.callbacks.set(id, fn); return id;
    }
    public unsubscribe(id: string): void { this.callbacks.delete(id); }
    public deliver(): void { for (const fn of this.callbacks.values()) fn(); }
    public publish(): void { this.version++; this.deliver(); }
}

const turn = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

describe('computed envelope ownership R44-A02', () => {
    test.each([false, true])('active consumers retain warm identity across jobs strict=%s', async strict => {
        const first = new External(), second = new External();
        let commits = 0;
        const seen: Array<{n: number}> = [];
        const View = ({source}: {source: IComputed<{n: number}>}) => {
            const value = useComputedValue(source); seen.push(value); return <p>{value.n}</p>;
        };
        const tree = (source: External) => {
            const children = <Profiler id="consumers" onRender={() => { commits++; }}>
                <View source={source}/><View source={source}/><View source={source}/>
            </Profiler>;
            return strict ? <StrictMode>{children}</StrictMode> : children;
        };
        const mounted = render(tree(first));
        try {
            expect(first.callbacks.size).toBe(3);
            const warm = commits;
            for (let i = 0; i < 3; i++) await act(async () => { await turn(); first.deliver(); });
            expect(commits).toBe(warm); expect(mounted.container.textContent).toBe('111');
            const old = first.value;
            await act(async () => { first.value.n = 2; first.publish(); });
            expect(mounted.container.textContent).toBe('222'); expect(commits).toBe(warm + 1);
            expect(seen.every(value => value === old)).toBe(true);
            const published = commits;
            await act(async () => { await turn(); first.deliver(); });
            expect(commits).toBe(published);
            await act(async () => first.publish());
            expect(commits).toBe(published + 1);
            first.pending = () => { first.value = {n: 3}; first.version++; };
            await act(async () => first.deliver());
            expect(mounted.container.textContent).toBe('333');
            await act(async () => { first.value = {n: 4}; first.deliver(); });
            expect(mounted.container.textContent).toBe('444');
            const late = [...first.callbacks.values()];
            mounted.rerender(tree(second));
            expect(first.callbacks.size).toBe(0); expect(second.callbacks.size).toBe(3);
            expect(mounted.container.textContent).toBe('111');
            const swapped = commits;
            await act(async () => { await turn(); first.publish(); for (const fn of late) fn(); });
            expect(commits).toBe(swapped); expect(mounted.container.textContent).toBe('111');
            await act(async () => { second.value.n = 5; second.publish(); });
            expect(mounted.container.textContent).toBe('555');
            const retired = [...second.callbacks.values()];
            mounted.unmount();
            await act(async () => { await turn(); for (const fn of retired) fn(); });
            expect(second.callbacks.size).toBe(0); expect(mounted.container.textContent).toBe('');
        } finally { mounted.unmount(); }
    });

    test.each([false, true])('suspended source swap cancel/resume=%s', async resume => {
        const first = new External(), second = new External(); second.value = {n: 10};
        let ready = false, suspended = false, release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        function View({source, block}: {source: External; block: boolean}): React.ReactNode {
            const value = useComputedValue(source);
            // oxlint-disable-next-line react/globals -- Records that the controlled suspension was reached.
            if (block && !ready) { suspended = true; throw pending; }
            return <p>{value.n}</p>;
        }
        const tree = (source: External, block = false) =>
            <Suspense fallback={<p>waiting</p>}><View source={source} block={block}/></Suspense>;
        const mounted = render(tree(first));
        try {
            await act(async () => startTransition(() => mounted.rerender(tree(second, true))));
            expect(suspended).toBe(true); expect(mounted.container.textContent).toBe('1');
            expect(first.callbacks.size).toBe(1); expect(second.callbacks.size).toBe(0);
            await act(async () => { first.value.n = 2; first.publish(); await turn(); });
            expect(mounted.container.textContent).toBe('2');
            if (!resume) mounted.rerender(tree(first));
            await act(async () => { ready = true; release(); await pending; });
            expect(mounted.container.textContent).toBe(resume ? '10' : '2');
            expect(first.callbacks.size).toBe(resume ? 0 : 1);
            expect(second.callbacks.size).toBe(resume ? 1 : 0);
            await act(async () => { second.value.n = 11; second.publish(); });
            expect(mounted.container.textContent).toBe(resume ? '11' : '2');
        } finally { mounted.unmount(); }
        expect(first.callbacks.size + second.callbacks.size).toBe(0);
    });

    test('SSR never subscribes and native lazy tokens follow get', () => {
        class Store extends Carburetor<{n: number}> {
            public increment(): void { this.update(data => { data.n++; }); }
        }
        const store = new Store({n: 1});
        const native = computed(read => ({n: read(store).n}));
        const external = new External();
        const View = ({source}: {source: IComputed<{n: number}>}) => <p>{useComputedValue(source).n}</p>;
        expect(renderToString(<View source={native}/>)).toBe('<p>1</p>');
        expect(renderToString(<View source={external}/>)).toBe('<p>1</p>');
        expect(external.callbacks.size).toBe(0);
        store.increment(); expect(native.get().n).toBe(2);
        external.pending = () => { external.value = {n: 2}; external.version++; };
        expect(renderToString(<View source={external}/>)).toBe('<p>2</p>');
        expect(renderToString(<View source={native}/>)).toBe('<p>2</p>');
        expect(external.callbacks.size).toBe(0);
    });
});

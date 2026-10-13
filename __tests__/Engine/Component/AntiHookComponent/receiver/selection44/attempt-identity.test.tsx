import * as React from 'react';
import {act, startTransition, StrictMode, Suspense} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, Carburetor, ISubscribeOptions, TSubscriber} from '@/Carburetor';

class Store extends Carburetor<{n: number; unread: number}> {
    public active = new Set<string>();
    public adds = 0;
    public drops = 0;
    public reads = 0;
    public callbacks: TSubscriber[] = [];
    public edit(fn: (data: {n: number; unread: number}) => void): void { this.update(fn); }
    public read(fn: Parameters<Carburetor<{n: number; unread: number}>['read']>[0])
        : ReturnType<Carburetor<{n: number; unread: number}>['read']> {
        this.reads++;
        return super.read(fn);
    }
    public subscribe(fn: TSubscriber, options: ISubscribeOptions = {}): string {
        const id = super.subscribe(fn, options);
        this.active.add(id); this.adds++; this.callbacks.push(fn);
        return id;
    }
    public unsubscribe(id: string): void {
        this.active.delete(id); this.drops++; super.unsubscribe(id);
    }
}

type Config = {source: Store; show: boolean; block: boolean; tick: number};

describe('selection attempt identity R44-A01', () => {
    for (const self of [false, true]) for (const stateful of [false, true]) {
        for (const strict of [false, true]) for (const resume of [false, true]) {
            test(`self=${self} state=${stateful} strict=${strict} resume=${resume}`, async () => {
                const first = new Store({n: 1, unread: 0});
                const second = new Store({n: 10, unread: 0});
                let release!: () => void;
                const pending = new Promise<void>(resolve => { release = resolve; });
                let ready = false, suspended = false, owner: Owner | null = null, commits = 0;
                let last: {n: number} | undefined;
                const initial: Config = {source: first, show: true, block: false, tick: 0};
                function Gate(): React.ReactNode {
                    if (!ready) { suspended = true; throw pending; }
                    return null;
                }
                const Child = React.memo(({value}: {value: {readonly n: number}}) => <p>{value.n}</p>);
                class Owner extends AntiHookComponent<Config, Config> {
                    public state = initial;
                    private readonly pick = this.connectSelection(
                        () => (stateful ? this.state : this.props).source, data => ({n: data.n})
                    );
                    public componentDidMount(): void { super.componentDidMount(); commits++; }
                    public componentDidUpdate(prev: Config): void { super.componentDidUpdate(prev); commits++; }
                    public render(): React.ReactNode {
                        const config = stateful ? this.state : this.props;
                        if (!config.show) return <p>off</p>;
                        const value = this.pick();
                        if (!config.block && config.source === first && value.n === 1) {
                            if (last) expect(value).toBe(last);
                            last = value;
                        }
                        if (config.block && self && !ready) { suspended = true; throw pending; }
                        return <><Child value={value}/>{config.block && !self ? <Gate/> : null}</>;
                    }
                }
                const tree = (config: Config) => {
                    const child = <Suspense fallback={<p>waiting</p>}>
                        <Owner {...config} ref={value => { owner = value; }}/>
                    </Suspense>;
                    return strict ? <StrictMode>{child}</StrictMode> : child;
                };
                const mounted = render(tree(initial));
                const update = (config: Config): void => {
                    if (stateful) owner!.setState(config);
                    else mounted.rerender(tree(config));
                };
                try {
                    expect(mounted.container.textContent).toBe('1');
                    const warm = [first.reads, first.adds, first.drops];
                    await act(async () => update({...initial, tick: 1}));
                    expect([first.reads, first.adds, first.drops]).toEqual(warm);
                    await act(async () => startTransition(() => update({
                        source: second, show: true, block: true, tick: 2,
                    })));
                    expect(suspended).toBe(true);
                    expect(mounted.container.textContent).toBe('1');
                    expect(second.active.size).toBe(0);
                    await act(async () => first.edit(data => { data.n = 2; }));
                    expect(mounted.container.textContent).toBe('2');
                    expect(first.active.size).toBe(1);
                    if (resume) {
                        await act(async () => { ready = true; release(); await pending; });
                        expect(mounted.container.textContent).toBe('10');
                        expect(first.active.size).toBe(0); expect(second.active.size).toBe(1);
                    } else {
                        await act(async () => update({...initial, show: false, tick: 3}));
                        expect(mounted.container.textContent).toBe('off');
                        expect(first.active.size + second.active.size).toBe(0);
                        await act(async () => { ready = true; release(); await pending; });
                        expect(mounted.container.textContent).toBe('off');
                    }
                    await act(async () => update({source: second, show: false, block: false, tick: 4}));
                    const hidden = commits;
                    await act(async () => {
                        first.edit(data => { data.n = 3; }); second.edit(data => { data.n = 11; });
                    });
                    expect(commits).toBe(hidden); expect(mounted.container.textContent).toBe('off');
                    await act(async () => update({source: second, show: true, block: false, tick: 5}));
                    expect(mounted.container.textContent).toBe('11');
                    expect(second.active.size).toBe(1);
                    const quiet = commits;
                    await act(async () => second.edit(data => { data.unread++; }));
                    expect(commits).toBe(quiet);
                    await act(async () => second.edit(data => { data.n = 12; }));
                    expect(mounted.container.textContent).toBe('12'); expect(commits).toBeGreaterThan(quiet);
                    const late = [...first.callbacks, ...second.callbacks];
                    mounted.unmount();
                    await act(async () => { for (const callback of late) callback(); });
                    expect(first.active.size + second.active.size).toBe(0);
                    expect(mounted.container.textContent).toBe('');
                } finally { mounted.unmount(); }
            });
        }
    }
});

import {React, act, render, AntiHookComponent, EResourceStatus, flush} from '../support';
import {Carburetor, IDict, IResourceResolution, IResourceSource, IResourceView} from '@/Carburetor';

/**
 * R16-10(4): `IResourceSource` is `resolve(args) -> {key, path, view}` plus `load(args)` — the
 * six-member split (`keyOf`/`pathOf`/`pathOfKey`/`getEntry`/`getEntryByKey`/`load`) is gone from
 * the interface. This source implements only that pair (plus the `ICarburetorSubscription`
 * surface `Carburetor` already provides) and proves `useResource` needs nothing else, in the
 * class-component form.
 */
interface ICustomEntry {
    status: EResourceStatus;
    value: string | undefined;
}

interface ICustomSourceData {
    entries: IDict<ICustomEntry>;
}

class MinimalResourceSource extends Carburetor<ICustomSourceData> implements IResourceSource<string, string> {
    public loadCalls: string[] = [];

    constructor(private readonly loader: (id: string) => Promise<string>) {
        super({entries: {}});
    }

    public resolve(id: string): IResourceResolution<string> {
        const entry = this.data.entries[id];
        const view: IResourceView<string> = {
            status: entry?.status ?? EResourceStatus.Idle,
            data: entry?.value,
            error: undefined,
            updatedAt: undefined,
            refreshing: false,
            invalidated: false,
            failed: false,
            stale: entry === undefined,
        };

        return {key: id, path: `entries.${id}`, view};
    }

    public load(id: string): Promise<void> {
        this.loadCalls.push(id);

        this.draft.entries[id] = {status: EResourceStatus.Pending, value: undefined};
        this.emitUpdate();

        return this.loader(id).then((value: string) => {
            this.draft.entries[id] = {status: EResourceStatus.Success, value};
            this.emitUpdate();
        });
    }
}

describe('a custom IResourceSource implementing only resolve()/load()', () => {
    test('useResource() loads a stale entry and renders its settled value', async () => {
        const settle: Array<(value: string) => void> = [];
        const source = new MinimalResourceSource((id: string) => new Promise<string>((resolve) => {
            settle.push(() => resolve(`loaded-${id}`));
        }));

        class Row extends AntiHookComponent<{id: string}> {
            render() {
                const entry = this.useResource(source, this.props.id);

                return <span className="value">{entry.data ?? entry.status}</span>;
            }
        }

        const {container} = render(<Row id="a" />);

        expect(container.querySelector('.value')?.textContent).toEqual(EResourceStatus.Pending);
        expect(source.loadCalls).toEqual(['a']);

        settle[0]('loaded-a');
        await flush();

        expect(container.querySelector('.value')?.textContent).toEqual('loaded-a');
    });

    test('useResource() subscribes to the resolved path alone', async () => {
        const source = new MinimalResourceSource((id: string) => Promise.resolve(`loaded-${id}`));
        const renders: string[] = [];

        class Row extends AntiHookComponent<{id: string}> {
            render() {
                renders.push(this.props.id);

                const entry = this.useResource(source, this.props.id);

                return <span className="value">{entry.data ?? entry.status}</span>;
            }
        }

        render(<Row id="a" />);
        await flush();

        renders.length = 0;

        // A write to an entry this component never resolved must not re-render it.
        await act(async () => {
            await source.load('unrelated');
        });

        expect(renders).toEqual([]);
    });
});

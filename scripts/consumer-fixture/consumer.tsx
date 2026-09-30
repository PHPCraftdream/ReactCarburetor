import * as React from "react";
import {
    AntiHookComponent,
    Carburetor,
    CarburetorProvider,
    CarburetorScope,
    Computed,
    ResourceCache,
    ScopedAntiHookComponent,
    carburetorToken,
} from "react-carburetor";
import {useCarburetorValue, useComputedValue} from "react-carburetor/interop";

/**
 * Consumer-matrix fixture: compiled and run against the packed tarball, once per cell,
 * never against repo source.
 *
 * Exercises class components extending the consumer's own React, connect()/connectSelection()/useComputed()/useResource(),
 * CarburetorProvider, and both interop hooks — inside one render.
 */
interface IData {
    count: number;
}

class Store extends Carburetor<IData> {
    /** Bumps the count; unused here, kept so the fixture matches a real store shape. */
    public inc(): void {
        this.draft.count += 1;
        this.emitUpdate();
    }
}

export const store = new Store({count: 1});
export const resource = new ResourceCache<string, number>(async (id: number) => `item-${id}`);
export const computed = new Computed<number>((read) => read(store).count * 2);

/** Set by Direct.render(); the harness checks it against its own require/import of React. */
export const registry: {instance: unknown} = {instance: null};

export class Direct extends AntiHookComponent {
    /** A persistent connect() view of the module-level store. */
    private readonly view = this.connect(store);
    /** A connectSelection() view of the same store, read as a plain snapshot. */
    private readonly selection = this.connectSelection(store, (data) => ({count: data.count}));

    /** Renders connect()/connectSelection()/useComputed()/useResource() output as one string. */
    public render(): React.ReactNode {
        registry.instance = this;

        const doubled = this.useComputed(computed);
        const entry = this.useResource(resource, 1);
        const text = `direct:${this.view.count}:${this.selection().count}:${doubled}:${entry.status}`;

        return <span data-testid="direct">{text}</span>;
    }
}

const scopedToken = carburetorToken(() => new Store({count: 5}), 'consumer-matrix/scoped-store');

export class Scoped extends ScopedAntiHookComponent {
    /** Resolves the scope-backed store and renders its tracked count. */
    public render(): React.ReactNode {
        const count = this.useCarburetor(this.resolve(scopedToken)).count;

        return <span data-testid="scoped">{`scoped:${count}`}</span>;
    }
}

const scope = new CarburetorScope();

/** Renders both interop hooks against the module-level store and computed. */
export function HooksConsumer(): React.ReactElement {
    const count = useCarburetorValue(store, (data) => data.count);
    const doubled = useComputedValue(computed);

    return <span data-testid="hooks">{`hooks:${count}:${doubled}`}</span>;
}

/** The fixture's whole tree: a provider around one direct, one scoped, one hooks consumer. */
export function App(): React.ReactElement {
    return (
        <CarburetorProvider scope={scope}>
            <Direct />
            <Scoped />
            <HooksConsumer />
        </CarburetorProvider>
    );
}

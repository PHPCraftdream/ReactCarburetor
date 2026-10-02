import * as React from "react";
import {
    AntiHookComponent,
    Carburetor,
    CarburetorProvider,
    CarburetorScope,
    Computed,
    IReadableCarburetor,
    ISubscribeOptions,
    ResourceCache,
    ScopedAntiHookComponent,
    TSubscriber,
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
interface IReadOnlyData {
    count: number;
}


/** Rejects mutation through a tracked view; getData() remains raw. */
const rejectReadOnlyWrite = (): never => {
    throw new Error('read-only');
};
let readableData: IReadOnlyData = {count: 7};
let readableVersion = 0;
let nextReadableSubscription = 0;
const readableListeners = new Map<string, {
    callback: TSubscriber;
    reads: ReadonlySet<string> | undefined;
}>();

/** A consumer-owned source with only the public readable/subscription capabilities. */
export const readableSource: IReadableCarburetor<IReadOnlyData> = {
    getUID: () => 'consumer-readable',
    getVersion: () => readableVersion,
    getData: () => readableData,
    read: (record) => new Proxy(readableData, {
        get(target, key, receiver) {
            if (typeof key === 'string') {
                record(key);
            }
            return Reflect.get(target, key, receiver);
        },
        set: rejectReadOnlyWrite,
        deleteProperty: rejectReadOnlyWrite,
        defineProperty: rejectReadOnlyWrite,
        setPrototypeOf: rejectReadOnlyWrite,
        preventExtensions: rejectReadOnlyWrite,
    }),
    subscribe: (callback, options: ISubscribeOptions = {}) => {
        const id = options.id ?? `consumer-readable:${++nextReadableSubscription}`;
        readableListeners.set(id, {
            callback,
            reads: options.reads === undefined ? undefined : new Set(options.reads),
        });
        return id;
    },
    unsubscribe: (id) => {
        readableListeners.delete(id);
    },
};

/** Publish to relevant readers.
 *
 * @param next - next source state.
 * @param changedKeys - changed dependency names.
 */
export const publishReadable = (next: IReadOnlyData, changedKeys: ReadonlySet<string>): void => {
    readableData = next;
    readableVersion++;
    const listeners = Array.from(readableListeners.values());
    for (const listener of listeners) {
        if (listener.reads === undefined || [...listener.reads].some((key) => changedKeys.has(key))) {
            listener.callback();
        }
    }
};

export const readableComputed = new Computed<number>((read) => read(readableSource).count);

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
    /** A persistent connect() view of the native store. */
    private readonly view = this.connect(store);
    /** A connectSelection() snapshot of the native store. */
    private readonly selection = this.connectSelection(store, (data) => ({count: data.count}));
    /** Persistent readable view. */
    private readonly readableView = this.connect(readableSource);
    /** Detached readable selection. */
    private readonly readableSelection = this.connectSelection(
        readableSource, (data) => ({count: data.count})
    );
    /** Renders connect()/connectSelection()/useComputed()/useResource() output as one string. */
    public render(): React.ReactNode {
        registry.instance = this;

        const doubled = this.useComputed(computed);
        const entry = this.useResource(resource, 1);
        const trackedReadableCount = this.useCarburetor(readableSource).count;
        const selectedReadableCount = this.readableSelection().count;
        const text =
            `direct:${this.view.count}:${this.selection().count}:${doubled}:${entry.status}:` +
            `readable:${this.readableView.count}:${selectedReadableCount}:${trackedReadableCount}`;
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
    const readableCount = useCarburetorValue(readableSource, (data) => data.count);
    const count = useCarburetorValue(store, (data) => data.count);
    const doubled = useComputedValue(computed);
    const readableDoubled = useComputedValue(readableComputed);

    return <span data-testid="hooks">{`hooks:${count}:${doubled}:readable:${readableCount}:${readableDoubled}`}</span>;
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

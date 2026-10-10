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
    IResourceSource,
    IResourceView,
    TReadonly,
    TSubscriber,
    carburetorToken,
} from "react-carburetor";
import {useCarburetorValue, useComputedValue, useResourceValue} from "react-carburetor/interop";

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


interface IResource41Data {nested: {name: string; unread: number}}
class Resource41Cache extends ResourceCache<IResource41Data, string> {
    /** Writes precisely one leaf, so unread precision is not confused with restore().
     *
     * @param field - nested leaf to update.
     * @param value - replacement leaf value.
     */
    public edit(field: 'name' | 'unread', value: string | number): void {
        const key = this.resolve('user').key;
        this.update(draft => {
            const nested = draft.entries[key].data!.nested;
            if (field === 'name') nested.name = String(value);
            else nested.unread = Number(value);
        });
    }
}
export const resource41 = new Resource41Cache(
    async () => ({nested: {name: 'Ada', unread: 0}}), {ttl: Infinity}
);
export const resource41Control = new Resource41Cache(
    async () => ({nested: {name: 'Ada', unread: 0}}), {ttl: Infinity}
);
export const resource41Counts = {child: 0, parent: 0, control: 0};
export let resource41Retained: TReadonly<{nested: {name: string}}> | undefined;
const resource41Sparse: string[] = [];
resource41Sparse.length = 3;
resource41Sparse[2] = 'Ada';
export const resource41Native = {date: new Date(123), map: new Map([['user', {name: 'Ada'}]]),
    set: new Set(['user']), sparse: resource41Sparse};
/** Exercises native detachment through published hook declarations. */
export function Resource41NativeConsumer({source = resource41}: {
    source?: IResourceSource<IResource41Data, string>;
}): React.ReactElement {
    const selected = useResourceValue(source, 'user', view => ({...resource41Native, name: view.data!.nested.name}));
    if (selected.date === resource41Native.date || selected.map === resource41Native.map
        || selected.set === resource41Native.set || 0 in selected.sparse) throw new Error('native detachment');
    return <span>{selected.name}:{selected.date.getTime()}:{selected.map.get('user')!.name}:{selected.set.size}</span>;
}
/** Cross-format source and hook combinations retain canonical structural protocols. */
export function Resource41CrossConsumer({source}: {
    source: IResourceSource<IResource41Data, string>;
}): React.ReactElement {
    const data = useResourceValue(source, 'user', selectResource41);
    return <Resource41Child data={data}/>;
}
const selectResource41 = (view: TReadonly<IResourceView<IResource41Data>>) => ({
    nested: {name: view.data!.nested.name},
});
const Resource41Child = React.memo(({data}: {data: {readonly nested: {readonly name: string}}}) => {
    // oxlint-disable-next-line react/immutability, react/globals -- Actual memo-render counter.
    resource41Counts.child++;
    return <span>{data.nested.name}</span>;
});
const Resource41ControlChild = React.memo(({data}: {data: {readonly nested: {readonly name: string}}}) => {
    // oxlint-disable-next-line react/immutability, react/globals -- Positive class-route render-count control.
    resource41Counts.control++;
    return <span>{data.nested.name}</span>;
});
export class Resource41ClassConsumer extends AntiHookComponent<{tick: number}> {
    /** Detached memo-child projection; loading remains owned by useResource. */
    private readonly selected = this.connectSelection(resource41Control, view => ({
        nested: {name: view.entries[resource41Control.resolve('user').key].data!.nested.name},
    }));
    /** Precise detached class selection, with useResource providing loading only. */
    public render(): React.ReactNode {
        this.useResource(resource41Control, 'user');
        return <Resource41ControlChild data={this.selected()}/>;
    }
}
/** Strict public declarations and a genuine memo-child consumer, not a raw-data route. */
export function Resource41Consumer({tick}: {tick: number}): React.ReactElement {
    void tick;
    // oxlint-disable-next-line react/immutability, react/globals -- Parent-render counter.
    resource41Counts.parent++;
    const data = useResourceValue(resource41, 'user', selectResource41);
    // oxlint-disable-next-line react/globals -- Retain the first packed selection for snapshot assertions.
    resource41Retained ??= data;
    return <Resource41Child data={data}/>;
}
/** Local presentation belongs to the caller, not to the readonly hook result. */
export function Resource41OverrideConsumer(): React.ReactElement {
    const data = useResourceValue(resource41, 'user', selectResource41);
    const local = {...data, nested: {...data.nested, name: 'local'}};
    return <span>{local.nested.name}</span>;
}

/** Packed declarations must reject omitted selectors, wrong arguments and readonly mutations. */
const resource41Types = () => {
    // @ts-expect-error selector is required
    useResourceValue(resource41, 'user');
    // @ts-expect-error argument type comes from the source
    useResourceValue(resource41, 123, selectResource41);
    const data = useResourceValue(resource41, 'user', selectResource41);
    // @ts-expect-error detached selected graph is readonly
    data.nested.name = 'unsafe';
    // @ts-expect-error result inference preserves the selected leaf type
    const wrong: number = data.nested.name;
    const native = useResourceValue(resource41, 'user', () => ({
        date: new Date(), map: new Map<string, {value: number}>(), set: new Set<string>(), list: [1],
    }));
    // @ts-expect-error readonly native date
    native.date.setTime(0);
    // @ts-expect-error readonly native map
    native.map.set('key', {value: 1});
    // @ts-expect-error readonly native set
    native.set.add('key');
    // @ts-expect-error readonly array
    native.list.push(2);
    void wrong;
};
void resource41Types;

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

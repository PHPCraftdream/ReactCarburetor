import {
    PATCH_OPAQUE, TAliasLedger, TPath, TPathRecorder, TPatchPort, TPatchRecorder,
} from "@/Carburetor/Models/Paths";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {clonePatchValue} from "@/Carburetor/Store/Tracking/Proxy/clonePatchValue";
import {deliverPatches} from "@/Carburetor/Store/Tracking/Proxy/deliverPatches";
import {IProxyCache} from "@/Carburetor/Store/Tracking/Models";
import {liveViews} from "@/Carburetor/Store/Tracking/Proxy/liveViews";
import {nativeAliasIndex} from "@/Carburetor/Store/Tracking/Aliases/NativeAliasIndex";

/** The write-proxy facilities a positional method needs, mirroring what the set trap uses. */
interface IPositionalHost {
    /** The array's tracked path. */
    readonly basePath: TPath;
    /** The array's unescaped path keys, for patch segments. */
    readonly basePathSegments: readonly string[];
    /** The write sink. */
    readonly record: TPathRecorder;
    /** Development alias and state-model validation; undefined in production. */
    readonly aliases: TAliasLedger | undefined;
    /** The branch-wrapper cache this tree shares. */
    readonly cache: IProxyCache;
    /** The current patch listener port, if any. */
    readonly patchPort: TPatchPort | undefined;
    /** `joinPath(basePath, key)`, memoized like the set trap's `length` path. */
    writtenPath(key: string, source?: object): TPath;
    /** This container's key-set marker path. */
    keysMarker(): TPath;
}

/**
 * Exchanges every engine view among the arguments for its raw target, the way the set trap
 * unwraps an assigned value; new containers are normalized so no view becomes state.
 *
 * @param value - the argument to unwrap.
 */
const unwrapArg = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    const raw: object = liveViews.readTarget(value) ?? value;

    if (raw !== value) {
        return raw;
    }

    liveViews.normalizeAssigned(raw);

    return raw;
};

/**
 * Attributes a finished positional operation: records one path per index whose occupant
 * changed identity (or own-ness), plus `length` and the key-set marker when they changed,
 * then reports index-level patches. Undo/redo replays these in reverse/forward order through
 * `installPatch`, restoring the exact per-index state.
 *
 * @param host - the write-proxy facilities.
 * @param before - the occupants before the call, `source.slice()`.
 * @param source - the raw array, already mutated.
 */
const attributePositional = (host: IPositionalHost, before: unknown[], source: unknown[]): void => {
    const listener = host.patchPort?.listener;
    const concrete = listener && !host.patchPort?.opaque ? listener : undefined;
    const patches: Parameters<TPatchRecorder>[0][] | undefined = concrete ? [] : undefined;
    const beforeLength = before.length;
    const afterLength = source.length;
    const limit = beforeLength > afterLength ? beforeLength : afterLength;
    let containersMoved = false;
    let anyChange = false;

    host.aliases?.checkWrite(source, host.basePath);

    for (let index = 0; index < limit; index++) {
        const wasOwn = index < beforeLength
            && Object.prototype.hasOwnProperty.call(before, index);
        const isOwn = index < afterLength
            && Object.prototype.hasOwnProperty.call(source, index);

        if (wasOwn === isOwn && (!wasOwn || Object.is(before[index], source[index]))) {
            continue;
        }

        anyChange = true;
        const previous: unknown = wasOwn ? before[index] : undefined;
        const next: unknown = isOwn ? source[index] : undefined;
        const key = String(index);
        const path = joinPath(host.basePath, key);

        host.aliases?.checkKey(source, key, path);
        host.aliases?.checkState(next, path, wasOwn ? previous : undefined);
        host.aliases?.forget(previous);
        host.record(path);

        if (wasOwn !== isOwn) {
            host.record(host.keysMarker());
        }

        if ((isTrackableItem(previous) || isTrackableItem(next))
            && host.cache.nativeAliasRoot !== undefined) {
            containersMoved = true;
        }

        if (patches !== undefined) {
            patches.push({
                segments: [...host.basePathSegments, key],
                previousExists: wasOwn, previous: clonePatchValue(previous),
                nextExists: isOwn, next: clonePatchValue(next),
            });
        }
    }

    if (containersMoved && host.cache.nativeAliasRoot !== undefined) {
        nativeAliasIndex.invalidate(host.cache.nativeAliasRoot);
    }

    if (afterLength !== beforeLength) {
        host.record(host.writtenPath('length', source));

        if (patches !== undefined) {
            patches.push({
                segments: [...host.basePathSegments, 'length'],
                previousExists: true, previous: beforeLength,
                nextExists: true, next: afterLength,
            });
        }
    }

    if (listener !== undefined && anyChange) {
        if (patches !== undefined) {
            deliverPatches(concrete!, patches);
        } else {
            listener(PATCH_OPAQUE);
        }
    }
};

/** @param value - candidate occupant. */
const isTrackableItem = (value: unknown): boolean =>
    value !== null && typeof value === 'object';

/**
 * Runs one intercepted positional method natively on the raw array and attributes the result.
 * The raw array may be left partially mutated when the native call throws; the attribution in
 * `finally` records whatever did land, the same partial trace the per-write set traps left.
 *
 * @param host - the write-proxy facilities.
 * @param key - the intercepted method name.
 * @param receiver - the `this` the method was invoked with, expectedly the draft proxy.
 * @param source - the raw array.
 * @param args - the invocation arguments, engine views unwrapped before the native call.
 */
export const runPositional = (
    host: IPositionalHost, key: string, receiver: unknown, source: unknown[], args: unknown[]
): unknown => {
    const native = (Array.prototype as unknown as Record<string, (...args: unknown[]) => unknown>)[key];
    const before = source.slice();
    let result: unknown;

    try {
        if (key === 'splice' || key === 'unshift' || key === 'fill') {
            const unwrapped = args.map(unwrapArg);
            result = native.apply(source, unwrapped);
        } else {
            result = native.apply(source, args);
        }
    } finally {
        attributePositional(host, before, source);
    }

    // Spec return values: the mutators return the receiver, the extractors the removed data.
    // splice/shift hand back raw removed elements: detached from the graph, like any read of
    // state handed out of the store.
    if (key === 'sort' || key === 'reverse' || key === 'fill' || key === 'copyWithin') {
        return receiver !== undefined && typeof receiver === 'object' ? receiver : result;
    }

    return result;
};

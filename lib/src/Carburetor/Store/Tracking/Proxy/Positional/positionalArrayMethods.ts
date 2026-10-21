import {
    PATCH_OPAQUE, TAliasLedger, TPath, TPatchPort, TPatchRecorder, TWriteRecorder,
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
    /** The write sink, carrying the raw mutated array. */
    readonly record: TWriteRecorder;
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

/** The half-open index range one positional call can touch; undefined means the whole array. */
interface IPositionalWindow {
    /** First index whose occupant may change. */
    start: number;
    /** One past the last index whose occupant may change. */
    end: number;
    /** Whether the range is trusted as complete only when the native result matches it. */
    verify: (result: unknown, oldLength: number, source: unknown[]) => boolean;
}

/** `ToIntegerOrInfinity` truncated to an integer; `undefined` and `NaN` become 0. */
const toIndex = (value: unknown): number => {
    if (value === undefined) return 0;
    const num = Number(value);
    return Number.isNaN(num) ? 0 : Math.trunc(num);
};

/** Clamps a spec-relative start or end to `[0, length]`. */
const clampIndex = (value: number, length: number): number =>
    value < 0 ? Math.max(length + value, 0) : Math.min(value, length);

/** The `splice` window: slot-replacement touches `[start, start + count)`, everything else the tail. */
const spliceWindow = (args: unknown[], length: number): IPositionalWindow => {
    const start = clampIndex(toIndex(args[0]), length);
    // An explicitly passed undefined deleteCount coerces to zero per spec; only an omitted
    // second argument removes through the end.
    const deleteCount = args.length > 1
        ? Math.max(0, Math.min(toIndex(args[1]), length - start))
        : length - start;
    const items = args.length > 2 ? args.length - 2 : 0;
    if (deleteCount === items) {
        return {
            start, end: start + items,
            verify: (result, oldLength, source) => Array.isArray(result) && result.length === items
                && source.length === oldLength,
        };
    }
    return {start, end: Number.MAX_SAFE_INTEGER, verify: () => true};
};

/** The `fill` window is exactly the filled range; an omitted or undefined end is the length. */
const fillWindow = (args: unknown[], length: number): IPositionalWindow => ({
    start: clampIndex(toIndex(args[1]), length),
    end: clampIndex(args[2] === undefined ? length : toIndex(args[2]), length),
    verify: () => true,
});

/** The `copyWithin` window is the target range of the copied span. */
const copyWithinWindow = (args: unknown[], length: number): IPositionalWindow => {
    const target = clampIndex(toIndex(args[0]), length);
    const from = clampIndex(toIndex(args[1]), length);
    const to = clampIndex(args[2] === undefined ? length : toIndex(args[2]), length);
    const count = Math.max(0, Math.min(to - from, length - from, length - target));
    return {start: target, end: target + count, verify: () => true};
};

/** Whether an index argument coerces predictably: objects with valueOf would coerce twice. */
const plainIndex = (value: unknown): boolean => value === undefined || typeof value === 'number';

/**
 * Derives the affected index window from the arguments before the native call; whole array for
 * the movers (`sort`/`reverse`/`shift`/`unshift`), non-numeric index arguments and anything else.
 *
 * @param key - the intercepted method name.
 * @param length - the array length before the call.
 * @param args - the invocation arguments.
 */
const positionalWindow = (key: string, length: number, args: unknown[]): IPositionalWindow | undefined => {
    const indexArgs = key === 'splice' ? args.slice(0, 2)
        : key === 'fill' ? args.slice(1, 3) : key === 'copyWithin' ? args.slice(0, 3) : [];
    if (!indexArgs.every(plainIndex)) return undefined;
    if (key === 'splice') return spliceWindow(args, length);
    if (key === 'fill') return fillWindow(args, length);
    if (key === 'copyWithin') return copyWithinWindow(args, length);
    return undefined;
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
 * @param window - the precomputed affected range, or undefined to compare every index.
 */
const attributePositional = (
    host: IPositionalHost, before: unknown[], source: unknown[], window: IPositionalWindow | undefined
): void => {
    const listener = host.patchPort?.listener;
    const concrete = listener && !host.patchPort?.opaque ? listener : undefined;
    const patches: Parameters<TPatchRecorder>[0][] | undefined = concrete ? [] : undefined;
    const beforeLength = before.length;
    const afterLength = source.length;
    const hardLimit = beforeLength > afterLength ? beforeLength : afterLength;
    const limit = window === undefined ? hardLimit : Math.min(window.end, hardLimit);
    const first = window === undefined ? 0 : Math.min(window.start, hardLimit);
    let containersMoved = false;
    let anyChange = false;

    host.aliases?.checkWrite(source, host.basePath, host.cache.nativeAliasRoot);

    for (let index = first; index < limit; index++) {
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
        host.record(path, source);

        if (wasOwn !== isOwn) {
            host.record(host.keysMarker(), source);
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
        host.record(host.writtenPath('length', source), source);

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
 *
 * The raw array may be left partially mutated when the native call throws; the attribution in
 * `finally` records whatever did land, the same partial trace the per-write set traps left —
 * a throw widens the attribution back to the whole array.
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
    const oldLength = before.length;
    let window = positionalWindow(key, oldLength, args);
    let result: unknown;

    try {
        if (key === 'splice' || key === 'unshift' || key === 'fill') {
            const unwrapped = args.map(unwrapArg);
            result = native.apply(source, unwrapped);
        } else {
            result = native.apply(source, args);
        }
        if (window !== undefined && !window.verify(result, oldLength, source)) window = undefined;
    } catch (error) {
        window = undefined;
        throw error;
    } finally {
        attributePositional(host, before, source, window);
    }

    // Spec return values: the mutators return the receiver, the extractors the removed data.
    // splice/shift hand back raw removed elements: detached from the graph, like any read of
    // state handed out of the store.
    if (key === 'sort' || key === 'reverse' || key === 'fill' || key === 'copyWithin') {
        return receiver !== undefined && typeof receiver === 'object' ? receiver : result;
    }

    return result;
};

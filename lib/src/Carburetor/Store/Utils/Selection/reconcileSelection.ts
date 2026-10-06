import {viewKeys} from "@/Carburetor/Store/Tracking/Models";
import {liveViews} from "@/Carburetor/Store/Tracking/Proxy/liveViews";
import {isPlainObject} from "@/Carburetor/Component/Connection/isPlainObject";
import {detachOpaqueInto} from "./detachCore";
import {createCollectionReconciler} from "./reconcileCollections";
const {reconcileMap, reconcileSet} = createCollectionReconciler();

type TReportLiveInstance = (instance: object) => void;
type TArraySubclassGuard = (instance: object) => never;

/** Everything one fused compare+detach walk shares: the copy ledger, pair topology and policies. */
interface IReconcileContext {
    copies: WeakMap<object, unknown>;
    previousCopies: WeakMap<object, unknown> | undefined;
    cycleCount: number;
    shared: boolean;
    open: WeakSet<object>;
    onLiveInstance: TReportLiveInstance | undefined;
    onArraySubclass: TArraySubclassGuard | undefined;
    previousToFresh: WeakMap<object, object>;
    freshToPrevious: WeakMap<object, object>;
    rawOf: (value: unknown) => object;
    isClassInstance: (value: unknown) => boolean;
    isMatchableKey: (key: unknown) => boolean;
    reconcile: (previous: unknown, live: unknown, raw: object, ctx: IReconcileContext) => unknown;
    register: (ctx: IReconcileContext, live: object, raw: object, copy: unknown) => void;
    /** Fired when the detached graph turns out not to be a tree (R37-01). */
    onSharing: () => void;
}

const hasPrototype = (value: object, prototype: object): boolean => Object.getPrototypeOf(value) === prototype;
const isPlainDate = (value: object): boolean => hasPrototype(value, Date.prototype);
const isPlainMap = (value: object): boolean => hasPrototype(value, Map.prototype);
const isPlainSet = (value: object): boolean => hasPrototype(value, Set.prototype);

/** A class instance has no selection copy representation (R6-02). */
const isClassInstance = (value: unknown): boolean =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && !isPlainObject(value) &&
    !isPlainDate(value) && !isPlainMap(value) && !isPlainSet(value);

/** Stores one copied field, handling an own `__proto__` key safely. */
const assign = (result: Record<string, unknown>, key: string, cloned: unknown): void => {
    if (key === '__proto__') {
        Object.defineProperty(result, key, {value: cloned, writable: true, enumerable: true, configurable: true});
    } else {
        result[key] = cloned;
    }
};

/** Resolves a live view to its raw graph member. */
const rawOf = (value: unknown): object =>
    value !== null && typeof value === 'object' ? liveViews.readTarget(value) ?? value as object : value as object;

/** Registers a completed container in this pass's ledger; the previous ledger is read-only. */
const register = (ctx: IReconcileContext, live: object, raw: object, copy: unknown): void => {
    ctx.copies.set(live, copy);
    ctx.copies.set(raw, copy);
};

const isMatchableKey = (key: unknown): boolean => key === null || typeof key !== 'object';

/** Reconciles one previous snapshot node with its fresh live read. */
const reconcile = (previous: unknown, live: unknown, raw: object, ctx: IReconcileContext): unknown => {
    if (isClassInstance(live)) {
        const instance = live as object;
        ctx.onLiveInstance?.(instance);
        register(ctx, instance, raw, instance);
        return instance;
    }
    if (live === null || typeof live !== 'object') return Object.is(previous, live) ? previous : live;
    const known = ctx.copies.get(live) ?? ctx.copies.get(raw);
    if (ctx.previousToFresh.get(previous as object) === raw) {
        ctx.cycleCount++;
        ctx.shared = true;
        if (ctx.open.has(raw)) {
            // An in-progress ancestor: returning `previous` keeps a content-equal visit
            // unchanged; the caller's cycleEntries remap installs the final copy and
            // flags changed only when the back edge points at a DIFFERENT node's copy
            // (a self back edge resolves to the copy being built, which is not a change).
            return previous;
        }
        return known ?? previous;
    }
    if (known !== undefined) {
        ctx.shared = true;
        if (liveViews.readTarget(live) !== undefined && !ctx.copies.has(live) && !Array.isArray(live)) {
            const keys = viewKeys(live);
            const branch = live as Record<string, unknown>;
            for (let index = 0; index < keys.length; index++) void branch[keys[index]];
        }
        return known;
    }
    if (previous === null || typeof previous !== 'object' || isClassInstance(previous)) {
        return detachOpaqueInto(live, ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass, ctx.onSharing);
    }
    const mapped = ctx.previousToFresh.get(previous);
    if (mapped !== undefined && mapped !== raw) {
        return detachOpaqueInto(live, ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass, ctx.onSharing);
    }
    const claimed = ctx.freshToPrevious.get(raw);
    if (claimed !== undefined && claimed !== previous) {
        return detachOpaqueInto(live, ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass, ctx.onSharing);
    }
    ctx.previousToFresh.set(previous, raw);
    ctx.freshToPrevious.set(raw, previous);
    ctx.open.add(raw);
    const livePrototype = Object.getPrototypeOf(live);
    const previousPrototype = Object.getPrototypeOf(previous);
    try {
        if (Array.isArray(live)) {
            if (livePrototype !== Array.prototype && livePrototype !== Object.prototype && livePrototype !== null) {
                ctx.onArraySubclass?.(live);
                ctx.onLiveInstance?.(live);
                register(ctx, live, raw, live);
                return live;
            }
            if (!Array.isArray(previous) || previousPrototype !== livePrototype) {
                return detachOpaqueInto(live, ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass, ctx.onSharing);
            }
            return reconcileArray(previous, live, raw, ctx);
        }
        if (isPlainDate(live) && isPlainDate(previous)) {
            const same = Object.is(Date.prototype.getTime.call(previous), Date.prototype.getTime.call(raw));
            const result = same ? previous : new Date(Date.prototype.getTime.call(raw));
            register(ctx, live, raw, result);
            return result;
        }
        if (isPlainMap(live) && isPlainMap(previous)) {
            return reconcileMap(previous as Map<unknown, unknown>, live, raw, ctx as never);
        }
        if (isPlainSet(live) && isPlainSet(previous)) {
            return reconcileSet(previous as Set<unknown>, live, raw, ctx as never);
        }
        if (isPlainObject(live) && isPlainObject(previous) && previousPrototype === livePrototype) {
            return reconcileKeyed(previous as Record<string, unknown>, live, raw, ctx);
        }
        return detachOpaqueInto(live, ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass, ctx.onSharing);
    } finally {
        ctx.open.delete(raw);
    }
};

/** Reconciles keyed objects, copying only the changed spine and preserving fresh key order. */
const reconcileKeyed = (
    previous: Record<string, unknown>, live: object, raw: object, ctx: IReconcileContext
): unknown => {
    const previousKeys = viewKeys(previous);
    const freshKeys = viewKeys(live);
    let mismatched = previousKeys.length !== freshKeys.length;
    if (!mismatched) {
        for (let index = 0; index < previousKeys.length; index++) {
            if (previousKeys[index] !== freshKeys[index]) { mismatched = true; break; }
        }
    }
    let changed = mismatched;
    let result: Record<string, unknown> | undefined;
    let previousMap: Map<string, unknown> | undefined;
    const cycleEntries: Array<{key: string; value: unknown; raw: object}> = [];
    const lookup = (key: string): {present: boolean; value: unknown} => {
        if (previousMap === undefined) {
            previousMap = new Map<string, unknown>();
            for (let index = 0; index < previousKeys.length; index++) {
                previousMap.set(previousKeys[index], previous[previousKeys[index]]);
            }
        }
        return previousMap.has(key) ? {present: true, value: previousMap.get(key)} : {present: false, value: undefined};
    };
    const ensure = (): Record<string, unknown> => {
        if (result !== undefined) return result;
        const prototype = Object.getPrototypeOf(live);
        result = prototype === Object.prototype ? {} : Object.create(prototype) as Record<string, unknown>;
        register(ctx, live, raw, result);
        for (let index = 0; index < freshKeys.length && index < previousKeys.length; index++) {
            if (freshKeys[index] === previousKeys[index]) assign(result, freshKeys[index], previous[freshKeys[index]]);
        }
        return result;
    };
    for (let index = 0; index < freshKeys.length; index++) {
        if (changed && result === undefined) ensure();
        const key = freshKeys[index];
        const childLive: unknown = Reflect.get(live, key);
        const found = mismatched ? lookup(key) : {present: true, value: previous[key]};
        if (!found.present) {
            changed = true;
            assign(ensure(), key, detachOpaqueInto(childLive, ctx.copies,
                ctx.onLiveInstance, ctx.onArraySubclass, ctx.onSharing));
            continue;
        }
        if (childLive !== null && typeof childLive === 'object') ensure();
        const childRaw = rawOf(childLive);
        const cycleBefore = ctx.cycleCount;
        const childResult = reconcile(found.value, childLive, childRaw, ctx);
        const cycled = ctx.cycleCount !== cycleBefore;
        if (cycled) cycleEntries.push({key, value: found.value, raw: childRaw});
        if (cycled && childResult !== found.value && childResult === result) {
            // A back edge to this very in-progress copy is not a change by itself: an otherwise
            // unchanged cyclic tree must still reuse the previous snapshot. The equality above
            // also proves `result` is the defined copy to write into.
            const copy = result;
            if (copy !== undefined) assign(copy, key, childResult);
        } else if (childResult !== found.value || isClassInstance(childLive)) {
            changed = true;
            assign(ensure(), key, childResult);
        } else if (result !== undefined) assign(result, key, childResult);
    }
    for (let index = 0; index < cycleEntries.length; index++) {
        const entry = cycleEntries[index];
        const fixed = ctx.copies.get(entry.raw);
        if (fixed !== undefined && fixed !== entry.value) {
            assign(result !== undefined ? result : ensure(), entry.key, fixed);
            if (entry.raw !== raw) changed = true;
        }
    }
    if (!changed) {
        register(ctx, live, raw, previous);
        return previous;
    }
    ensure();
    if (mismatched && result !== undefined) {
        // R37: the copy is already registered under its raw, and a detached subtree of this same
        // walk (an introduced back edge) may hold the registered object. Keep one identity: drop
        // vanished keys and move each fresh key into place instead of building a second object
        // the back edge would miss.
        const fresh = new Set<string>(freshKeys);
        for (const key of Object.keys(result)) {
            if (!fresh.has(key)) delete result[key];
        }
        for (let index = 0; index < freshKeys.length; index++) {
            const key = freshKeys[index];
            // An own `__proto__` data key participates in the fresh order too: the own property
            // shadows the prototype accessor, so read it, delete it, and re-install it in place.
            if (!Object.prototype.hasOwnProperty.call(result, key)) continue;
            const value = result[key];
            delete result[key];
            assign(result, key, value);
        }
    }
    register(ctx, live, raw, result);
    return result as Record<string, unknown>;
};

/** The previous copies this array's members will claim by raw identity, or undefined without a ledger. */
const claimedByLedger = (live: unknown[], ctx: IReconcileContext): Set<unknown> | undefined => {
    const ledger = ctx.previousCopies;
    if (ledger === undefined) return undefined;
    let claimed: Set<unknown> | undefined;
    const claim = (index: number): void => {
        const member: unknown = Reflect.get(live, index);
        if (member === null || typeof member !== 'object') return;
        const copy = ledger.get(rawOf(member));
        if (copy !== undefined) (claimed ??= new Set<unknown>()).add(copy);
    };
    let index = 0;
    for (; index < live.length && Object.prototype.hasOwnProperty.call(live, index); index++) claim(index);
    // Past the first hole only own keys are visited, so a sparse array stays O(own keys).
    if (index < live.length) {
        for (const key of Object.keys(live)) {
            if (isArrayIndex(key) && Number(key) > index) claim(Number(key));
        }
    }
    return claimed;
};

/** Reconciles arrays with a dense fast path and ordered sparse walk. */
const reconcileArray = (previous: unknown[], live: unknown[], raw: object, ctx: IReconcileContext): unknown => {
    const prototype = Object.getPrototypeOf(live);
    let changed = previous.length !== live.length;
    let result: unknown[] | undefined;
    let densePrefix = 0;
    const cycleEntries: Array<{index: number; value: unknown; raw: object}> = [];
    const claimed = claimedByLedger(live, ctx);
    // A member follows its own raw object's previous copy; the positional copy is a base only
    // when no other member claims it, so a moved row is never also the base of its neighbour.
    const baseFor = (childLive: unknown, positional: unknown): unknown => {
        const own = childLive !== null && typeof childLive === 'object'
            ? ctx.previousCopies?.get(rawOf(childLive)) : undefined;
        return own ?? (claimed?.has(positional) ? undefined : positional);
    };
    // A member with no positional counterpart still reuses its own raw object's previous copy.
    const appended = (childLive: unknown): unknown => {
        const own = childLive !== null && typeof childLive === 'object'
            ? ctx.previousCopies?.get(rawOf(childLive)) : undefined;
        return own === undefined
            ? detachOpaqueInto(childLive, ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass, ctx.onSharing)
            : reconcile(own, childLive, rawOf(childLive), ctx);
    };
    const ensure = (): unknown[] => {
        if (result !== undefined) return result;
        result = [];
        result.length = live.length;
        if (prototype !== Array.prototype) Object.setPrototypeOf(result, prototype);
        register(ctx, live, raw, result);
        for (let index = 0; index < densePrefix; index++) {
            if (Object.prototype.hasOwnProperty.call(previous, index)) result[index] = previous[index];
        }
        return result;
    };
    for (; densePrefix < live.length; densePrefix++) {
        const hasPrevious = Object.prototype.hasOwnProperty.call(previous, densePrefix);
        const hasNext = Object.prototype.hasOwnProperty.call(live, densePrefix);
        if (!hasPrevious || !hasNext) {
            if (hasPrevious !== hasNext) changed = true;
            break;
        }
        const childLive: unknown = Reflect.get(live, densePrefix);
        const childPrevious = baseFor(childLive, previous[densePrefix]);
        let childResult: unknown;
        if (childLive !== null && typeof childLive === 'object') {
            ensure();
            const cycleBefore = ctx.cycleCount;
            childResult = reconcile(childPrevious, childLive, rawOf(childLive), ctx);
            if (ctx.cycleCount !== cycleBefore) {
                cycleEntries.push({index: densePrefix, value: childPrevious, raw: rawOf(childLive)});
            }
        } else childResult = Object.is(childPrevious, childLive) ? childPrevious : childLive;
        if (childResult !== previous[densePrefix] || isClassInstance(childLive)) {
            changed = true;
            ensure()[densePrefix] = childResult;
        } else if (hasNext && result !== undefined) {
            ensure()[densePrefix] = childResult;
        }
    }
    if (densePrefix >= live.length) {
        if (changed) {
            ensure(); remapArrayCycles(ctx, raw, result, cycleEntries); register(ctx, live, raw, result); return result;
        }
        if (remapArrayCycles(ctx, raw, result, cycleEntries)) { register(ctx, live, raw, result); return result; }
        register(ctx, live, raw, previous); return previous;
    }
    if (changed && result === undefined) ensure();
        const previousKeys = Reflect.ownKeys(previous);
    const freshKeys = Reflect.ownKeys(live);
    const skipHead = (keys: PropertyKey[]): number => {
        let index = 0;
        while (index < keys.length && (!isArrayIndex(keys[index]) || Number(keys[index]) < densePrefix)) index++;
        return index;
    };
    let previousIndex = skipHead(previousKeys);
    let freshIndex = skipHead(freshKeys);
    while (true) {
        while (previousIndex < previousKeys.length && !isArrayIndex(previousKeys[previousIndex])) previousIndex++;
        while (freshIndex < freshKeys.length && (!isArrayIndex(freshKeys[freshIndex]) ||
            !Object.prototype.hasOwnProperty.call(raw, freshKeys[freshIndex]))) freshIndex++;
        const hasPreviousKey = previousIndex < previousKeys.length && isArrayIndex(previousKeys[previousIndex]);
        const hasFreshKey = freshIndex < freshKeys.length && isArrayIndex(freshKeys[freshIndex]);
        if (!hasPreviousKey && !hasFreshKey) break;
        if (!hasPreviousKey || !hasFreshKey) {
            changed = true;
            if (hasFreshKey) {
                const key = freshKeys[freshIndex] as string;
                ensure()[Number(key)] = appended(Reflect.get(live, key));
                freshIndex++;
            } else previousIndex++;
            continue;
        }
        const previousKey = previousKeys[previousIndex] as string;
        const freshKey = freshKeys[freshIndex] as string;
        if (previousKey === freshKey) {
            const childLive: unknown = Reflect.get(live, freshKey);
            const childPrevious = baseFor(childLive, previous[Number(previousKey)]);
            let childResult: unknown;
            if (childLive !== null && typeof childLive === 'object') {
                ensure();
                const cycleBefore = ctx.cycleCount;
                childResult = reconcile(childPrevious, childLive, rawOf(childLive), ctx);
                if (ctx.cycleCount !== cycleBefore) {
                    cycleEntries.push({index: Number(freshKey), value: childPrevious, raw: rawOf(childLive)});
                }
            } else childResult = Object.is(childPrevious, childLive) ? childPrevious : childLive;
            if (childResult !== previous[Number(previousKey)] || isClassInstance(childLive)) {
                changed = true; ensure()[Number(freshKey)] = childResult;
            } else if (result !== undefined) ensure()[Number(freshKey)] = childResult;
            previousIndex++; freshIndex++;
        } else if (Number(previousKey) < Number(freshKey)) { changed = true; previousIndex++; }
        else {
            changed = true;
            ensure()[Number(freshKey)] = appended(Reflect.get(live, freshKey));
            freshIndex++;
        }
    }
    if (!changed) {
        if (remapArrayCycles(ctx, raw, result, cycleEntries)) { register(ctx, live, raw, result); return result; }
        register(ctx, live, raw, previous); return previous;
    }
    ensure(); remapArrayCycles(ctx, raw, result, cycleEntries); register(ctx, live, raw, result); return result;
};

/** Points array cycle back edges at their changed ancestor copy. */
const remapArrayCycles = (
    ctx: IReconcileContext, raw: object, result: unknown[] | undefined,
    cycleEntries: Array<{index: number; value: unknown; raw: object}>
): boolean => {
    if (result === undefined) return false;
    let remappedChanged = false;
    for (let index = 0; index < cycleEntries.length; index++) {
        const entry = cycleEntries[index];
        const fixed = ctx.copies.get(entry.raw);
        if (fixed !== undefined && fixed !== entry.value) {
            result[entry.index] = fixed;
            if (entry.raw !== raw) remappedChanged = true;
        }
    }
    return remappedChanged;
};

/** True for canonical integer array-index property names. */
const isArrayIndex = (key: PropertyKey): key is string => {
    if (typeof key !== 'string') return false;
    const index = Number(key);
    return Number.isInteger(index) && index >= 0 && index < 0xFFFFFFFF && String(index) === key;
};

/**
 * Reconciles selection content and reuses the prior snapshot when unchanged.
 *
 * @param previous - Prior detached snapshot.
 * @param live - Fresh live selection.
 * @param onLiveInstance - Optional live-instance reporter.
 * @param onArraySubclass - Optional array-subclass rejection policy.
 * @param previousCopies - Prior reconciliation copy ledger.
 * @param copies - Current reconciliation copy ledger.
 * @param trace - Receives `shared`: a raw object reached twice or a cycle, so the snapshot is not a tree.
 * The verdict describes the actual detached graph, including the initial-detach path (R37-01).
 */
export const reconcileSelection = <T>(
    previous: unknown,
    live: unknown,
    onLiveInstance?: TReportLiveInstance,
    onArraySubclass?: TArraySubclassGuard,
    previousCopies?: WeakMap<object, unknown>,
    copies?: WeakMap<object, unknown>,
    trace?: {shared: boolean}
): T => {
    // R37-05: a primitive verdict needs no graph ledgers — decide it before any collection
    // is allocated. Matches `reconcile`'s own non-object branch exactly (`Object.is`).
    if (live === null || typeof live !== 'object') {
        if (trace !== undefined) trace.shared = false;
        return (Object.is(previous, live) ? previous : live) as T;
    }
    // A previous primitive under a live object is handled inside `reconcile` (opaque detach);
    // everything object-shaped still gets the full topology treatment below.
    copies ??= new WeakMap<object, unknown>();
    const ctx = {
        copies, previousCopies, previousToFresh: new WeakMap<object, object>(),
        freshToPrevious: new WeakMap<object, object>(),
        onLiveInstance, onArraySubclass, cycleCount: 0, shared: false, open: new WeakSet<object>(),
        reconcile,
        rawOf, register, isClassInstance, isMatchableKey,
    } as IReconcileContext;
    ctx.onSharing = () => {
        ctx.shared = true;
    };
    const result = reconcile(previous, live, rawOf(live), ctx) as T;
    if (trace !== undefined) trace.shared = ctx.shared;
    return result;
};

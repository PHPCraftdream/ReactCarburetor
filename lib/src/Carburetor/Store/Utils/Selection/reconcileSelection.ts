import {viewKeys} from "@/Carburetor/Store/Tracking/Models";
import {liveViews} from "@/Carburetor/Store/Tracking/Proxy/liveViews";
import {isPlainObject} from "@/Carburetor/Component/Connection/isPlainObject";
import {detachOpaqueInto} from "./detachCore";

type TReportLiveInstance = (instance: object) => void;
type TArraySubclassGuard = (instance: object) => never;
/** Everything one fused compare+detach walk shares: the copy ledger, pair topology and policies. */
interface IContext {
    /** Live view AND raw target -> reused previous or fresh copy; one raw, one copy. */
    copies: WeakMap<object, unknown>;
    /** Previous-side object -> canonical fresh raw member, as in sameSelection's pair maps. */
    previousToFresh: WeakMap<object, object>;
    /** Canonical fresh raw member -> previous-side object; a double claim is a topology mismatch. */
    freshToPrevious: WeakMap<object, object>;
    onLiveInstance: TReportLiveInstance | undefined;
    onArraySubclass: TArraySubclassGuard | undefined;
    /** Monotonic count of re-entries into pairs already under comparison (cycle back edges). */
    cycleCount: number;
    /** Fresh raw members whose container walk is in progress right now (true cycle back edges). */
    open: WeakSet<object>;
}

const hasPrototype = (value: object, prototype: object): boolean =>
    Object.getPrototypeOf(value) === prototype;

const isPlainDate = (value: object): boolean => hasPrototype(value, Date.prototype);
const isPlainMap = (value: object): boolean => hasPrototype(value, Map.prototype);
const isPlainSet = (value: object): boolean => hasPrototype(value, Set.prototype);

/** A class instance: nothing the selection model defines a copy for (R6-02). */
const isClassInstance = (value: unknown): boolean =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && !isPlainObject(value) &&
    !isPlainDate(value) && !isPlainMap(value) && !isPlainSet(value);

/** Whether a Map key can be matched across a detached copy and the live value: primitives only. */
const isMatchableKey = (key: unknown): boolean => key === null || typeof key !== 'object';

/** SameValueZero is the equality used by native Map keys and Set members. */
const sameValueZero = (a: unknown, b: unknown): boolean =>
    a === b || (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b));

/** Array index properties are the canonical integer keys below the array-index limit. */
const isArrayIndex = (key: PropertyKey): key is string => {
    if (typeof key !== 'string') {
        return false;
    }
    const index = Number(key);
    return Number.isInteger(index) && index >= 0 && index < 0xFFFFFFFF && String(index) === key;
};

/** Stores one copied field; an own key literally named `__proto__` needs defineProperty. */
const assign = (result: Record<string, unknown>, key: string, cloned: unknown): void => {
    if (key === '__proto__') {
        Object.defineProperty(result, key, {value: cloned, writable: true, enumerable: true, configurable: true});
    } else {
        result[key] = cloned;
    }
};

/** The raw graph member behind a value; only objects are probed, primitives are their own raw. */
const rawOf = (value: unknown): object =>
    value !== null && typeof value === 'object' ? liveViews.readTarget(value) ?? value as object : value as object;

/** Registers a finished container for both its live view and its raw target. */
const register = (ctx: IContext, live: object, raw: object, copy: unknown): void => {
    ctx.copies.set(live, copy);
    ctx.copies.set(raw, copy);
};

/** One fused compare+detach step: previous snapshot node vs its fresh live read (raw = its target). */
const reconcile = (previous: unknown, live: unknown, raw: object, ctx: IContext): unknown => {
    // A class instance stays live: identity is the only parent-visible comparison; hook/watch onLiveInstance throws.
    if (isClassInstance(live)) {
        const instance = live as object;
        ctx.onLiveInstance?.(instance);
        register(ctx, instance, raw, instance);
        return instance;
    }
    if (live === null || typeof live !== 'object') {
        return Object.is(previous, live) ? previous : live;
    }
    const known = ctx.copies.get(live) ?? ctx.copies.get(raw);
    // A cycle back edge presumes unchanged; a FINISHED pair hands out its own verdict (previous or the fresh copy).
    if (ctx.previousToFresh.get(previous as object) === raw) {
        ctx.cycleCount++;
        if (ctx.open.has(raw)) {
            return previous;
        }
        const resolved = ctx.copies.get(live) ?? ctx.copies.get(raw);
        return resolved !== undefined ? resolved : previous;
    }
    if (known !== undefined) {
        // Same bookkeeping as detachCore: visit a recognized view once, then reuse its copy.
        if (liveViews.readTarget(live) !== undefined && !ctx.copies.has(live) && !Array.isArray(live)) {
            const keys = viewKeys(live);
            const branch = live as Record<string, unknown>;
            for (let index = 0; index < keys.length; index++) {
                void branch[keys[index]];
            }
        }
        return known;
    }
    // No previous container to reconcile against (or an unusable one): a pure copy, no reuse.
    if (previous === null || typeof previous !== 'object' || isClassInstance(previous)) {
        return detachOpaqueInto(live, ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass);
    }
    // Topology mismatch (fresh claiming another previous, or two previous onto one fresh) yields a new shape.
    const mapped = ctx.previousToFresh.get(previous);
    if (mapped !== undefined && mapped !== raw) {
        return detachOpaqueInto(live, ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass);
    }
    const claimed = ctx.freshToPrevious.get(raw);
    if (claimed !== undefined && claimed !== previous) {
        return detachOpaqueInto(live, ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass);
    }
    ctx.previousToFresh.set(previous, raw);
    ctx.freshToPrevious.set(raw, previous);
    ctx.open.add(raw);
    const livePrototype = Object.getPrototypeOf(live);
    const previousPrototype = Object.getPrototypeOf(previous);
    try {
        if (Array.isArray(live)) {
            if (livePrototype !== Array.prototype && livePrototype !== Object.prototype && livePrototype !== null) {
                // Same policy as detachOpaque: reject or keep an unsupported array instance live.
                if (ctx.onArraySubclass !== undefined) {
                    ctx.onArraySubclass(live);
                }
                ctx.onLiveInstance?.(live);
                register(ctx, live, raw, live);
                return live;
            }
            if (!Array.isArray(previous) || previousPrototype !== livePrototype) {
                return detachOpaqueInto(live, ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass);
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
            return reconcileMap(previous as Map<unknown, unknown>, live, raw, ctx);
        }
        if (isPlainSet(live) && isPlainSet(previous)) {
            return reconcileSet(previous as Set<unknown>, live, raw, ctx);
        }
        if (isPlainObject(live) && isPlainObject(previous) && previousPrototype === livePrototype) {
            return reconcileKeyed(previous as Record<string, unknown>, live, raw, ctx);
        }
        return detachOpaqueInto(live, ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass);
    } finally {
        ctx.open.delete(raw);
    }
};

/** Keyed reconcile: only the changed spine is copied; unchanged subtrees keep previous references. */
const reconcileKeyed = (
    previous: Record<string, unknown>,
    live: object,
    raw: object,
    ctx: IContext
): unknown => {
    const previousKeys = viewKeys(previous);
    const freshKeys = viewKeys(live);
    let mismatched = previousKeys.length !== freshKeys.length;
    if (!mismatched) {
        for (let index = 0; index < previousKeys.length; index++) {
            if (previousKeys[index] !== freshKeys[index]) {
                mismatched = true;
                break;
            }
        }
    }
    let changed = mismatched;
    let result: Record<string, unknown> | undefined = undefined;
    let previousMap: Map<string, unknown> | undefined = undefined;
    // Cycle back edges resolved to `previous` here; remapped to the ancestor's copy when the container ends changed.
    const cycleEntries: Array<{key: string; value: unknown; raw: object}> = [];
    const lookup = (key: string): {present: boolean; value: unknown} => {
        if (previousMap === undefined) {
            previousMap = new Map<string, unknown>();
            for (let index = 0; index < previousKeys.length; index++) {
                previousMap.set(previousKeys[index], previous[previousKeys[index]]);
            }
        }
        return previousMap.has(key)
            ? {present: true, value: previousMap.get(key)}
            : {present: false, value: undefined};
    };
    // Registered BEFORE the first descent into an object child, so a cycle resolves to the copy under construction.
    const ensure = (): Record<string, unknown> => {
        if (result !== undefined) {
            return result;
        }
        const prototype = Object.getPrototypeOf(live);
        result = prototype === Object.prototype ? {} : Object.create(prototype) as Record<string, unknown>;
        register(ctx, live, raw, result);
        for (let index = 0; index < freshKeys.length && index < previousKeys.length; index++) {
            if (freshKeys[index] === previousKeys[index]) {
                assign(result, freshKeys[index], previous[freshKeys[index]]);
            }
        }
        return result;
    };
    for (let index = 0; index < freshKeys.length; index++) {
        if (changed && result === undefined) {
            // Pure shape change with no divergence yet: the container must exist so remaining equal children fit in it.
            ensure();
        }
        const key = freshKeys[index];
        const childLive: unknown = Reflect.get(live, key);
        if (mismatched) {
            const found = lookup(key);
            if (!found.present) {
                changed = true;
                assign(ensure(), key, detachOpaqueInto(childLive, ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass));
                continue;
            }
            if (childLive !== null && typeof childLive === 'object') {
                ensure();
            }
            const cycleBefore = ctx.cycleCount;
            const childResult = reconcile(found.value, childLive, rawOf(childLive), ctx);
            if (ctx.cycleCount !== cycleBefore) {
                cycleEntries.push({key, value: found.value, raw: rawOf(childLive)});
            }
            if (childResult !== found.value || isClassInstance(childLive)) {
                changed = true;
                assign(ensure(), key, childResult);
            } else if (result !== undefined) {
                assign(result, key, childResult);
            }
            continue;
        }
        const childPrevious = previous[key];
        if (childLive !== null && typeof childLive === 'object') {
            ensure();
        }
        const cycleBefore = ctx.cycleCount;
        const childResult = reconcile(childPrevious, childLive, rawOf(childLive), ctx);
        if (ctx.cycleCount !== cycleBefore) {
            cycleEntries.push({key, value: childPrevious, raw: rawOf(childLive)});
        }
        if (childResult !== childPrevious || isClassInstance(childLive)) {
            changed = true;
            assign(ensure(), key, childResult);
        } else if (result !== undefined) {
            assign(result, key, childResult);
        }
    }
    if (!changed) {
        // The walk descended and found everything equal: repair the ledger onto previous.
        register(ctx, live, raw, previous);
        return previous;
    }
    // Changed always implies a container: ensure() runs before every descent and at every divergence — and once more
    // here, so an all-keys-removed shape still yields `{}`. A pure reorder must land in the live key order: the
    // pair-wise backfill seeds unchanged children, so the copy is rebuilt in freshKeys order.
    ensure();
    if (mismatched && result !== undefined) {
        const orderedProto = Object.getPrototypeOf(live);
        const ordered: Record<string, unknown> =
            orderedProto === Object.prototype ? {} : Object.create(orderedProto) as Record<string, unknown>;
        for (let index = 0; index < freshKeys.length; index++) {
            const key = freshKeys[index];
            if (Object.prototype.hasOwnProperty.call(result, key)) {
                assign(ordered, key, result[key]);
            }
        }
        result = ordered;
    }
    register(ctx, live, raw, result);
    if (result !== undefined) {
        for (let index = 0; index < cycleEntries.length; index++) {
            const entry = cycleEntries[index];
            const fixed = ctx.copies.get(entry.raw);
            if (fixed !== undefined && fixed !== entry.value) {
                assign(result, entry.key, fixed);
            }
        }
    }
    return result as unknown as Record<string, unknown>;
};

/** Array reconcile: dense fast path, then the ordered sparse walk (holes/length/prototype count). */
const reconcileArray = (previous: unknown[], live: unknown[], raw: object, ctx: IContext): unknown => {
    const prototype = Object.getPrototypeOf(live);
    let changed = previous.length !== live.length;
    let result: unknown[] | undefined = undefined;
    let densePrefix = 0;
    const cycleEntries: Array<{index: number; value: unknown; raw: object}> = [];
    const ensure = (): unknown[] => {
        if (result !== undefined) {
            return result;
        }
        result = [];
        result.length = live.length;
        if (prototype !== Array.prototype) {
            Object.setPrototypeOf(result, prototype);
        }
        register(ctx, live, raw, result);
        for (let index = 0; index < densePrefix; index++) {
            if (Object.prototype.hasOwnProperty.call(previous, index)) {
                result[index] = previous[index];
            }
        }
        return result;
    };
    for (; densePrefix < live.length; densePrefix++) {
        const hasPrevious = Object.prototype.hasOwnProperty.call(previous, densePrefix);
        const hasNext = Object.prototype.hasOwnProperty.call(live, densePrefix);
        if (!hasPrevious || !hasNext) { // a hole ends the dense prefix; the sparse walk is O(own keys)
            if (hasPrevious !== hasNext) changed = true;
            break;
        }
        const childPrevious = previous[densePrefix];
        const childLive: unknown = Reflect.get(live, densePrefix);
        let childResult: unknown;
        if (childLive !== null && typeof childLive === 'object') {
            ensure();
            const cycleBefore = ctx.cycleCount;
            childResult = reconcile(childPrevious, childLive, rawOf(childLive), ctx);
            if (ctx.cycleCount !== cycleBefore) {
                cycleEntries.push({index: densePrefix, value: childPrevious, raw: rawOf(childLive)});
            }
        } else {
            childResult = Object.is(childPrevious, childLive) ? childPrevious : childLive;
        }
        if (childResult !== childPrevious || isClassInstance(childLive)) {
            changed = true;
            ensure()[densePrefix] = childResult;
        } else if (hasNext && result !== undefined) {
            // Only real slots are written: a shared hole must stay a hole in the copy.
            ensure()[densePrefix] = childResult;
        }
    }
    if (densePrefix >= live.length) {
        // Dense through the whole live array: the new tail was counted by the length check; a shrink needs its copy.
        if (changed) {
            ensure();
            remapArrayCycles(ctx, result, cycleEntries);
            register(ctx, live, raw, result);
            return result;
        }
        register(ctx, live, raw, previous);
        return previous;
    }
    // Sparse phase, ordered over own index keys like sameArrayContent; a pure deletion needs a container.
    if (changed && result === undefined) {
        ensure();
    }
    const previousKeys = Reflect.ownKeys(previous);
    const freshKeys = Reflect.ownKeys(live);
    // ownKeys is numerically sorted, so the dense prefix heads both lists; start past it — a fresh slot inside a hole
    // has an own key below no pointer.
    const skipHead = (keys: PropertyKey[]): number => {
        let index = 0;
        while (index < keys.length && (!isArrayIndex(keys[index]) || Number(keys[index]) < densePrefix)) {
            index++;
        }
        return index;
    };
    let previousIndex = skipHead(previousKeys);
    let freshIndex = skipHead(freshKeys);
    while (true) {
        while (previousIndex < previousKeys.length && !isArrayIndex(previousKeys[previousIndex])) {
            previousIndex++;
        }
        while (freshIndex < freshKeys.length && (!isArrayIndex(freshKeys[freshIndex]) ||
            // A hole read materializes the slot in the view's ownKeys; the raw object is authoritative, so the phantom
            // key is skipped, never detached as an undefined member.
            !Object.prototype.hasOwnProperty.call(raw, freshKeys[freshIndex]))) {
            freshIndex++;
        }
        const hasPreviousKey = previousIndex < previousKeys.length && isArrayIndex(previousKeys[previousIndex]);
        const hasFreshKey = freshIndex < freshKeys.length && isArrayIndex(freshKeys[freshIndex]);
        if (!hasPreviousKey && !hasFreshKey) {
            break;
        }
        if (!hasPreviousKey || !hasFreshKey) {
            changed = true;
            if (hasFreshKey) {
                const freshKey = freshKeys[freshIndex] as string;
                Reflect.get(live, freshKey);
                ensure()[Number(freshKey)] =
                    detachOpaqueInto(Reflect.get(live, freshKey), ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass);
                freshIndex++;
            } else {
                previousIndex++;
            }
            continue;
        }
        const previousKey = previousKeys[previousIndex] as string;
        const freshKey = freshKeys[freshIndex] as string;
        if (previousKey === freshKey) {
            const childPrevious = previous[Number(previousKey)];
            const childLive: unknown = Reflect.get(live, freshKey);
            let childResult: unknown;
            if (childLive !== null && typeof childLive === 'object') {
                ensure();
                const cycleBefore = ctx.cycleCount;
                childResult = reconcile(childPrevious, childLive, rawOf(childLive), ctx);
                if (ctx.cycleCount !== cycleBefore) {
                    cycleEntries.push({index: Number(freshKey), value: childPrevious, raw: rawOf(childLive)});
                }
            } else {
                childResult = Object.is(childPrevious, childLive) ? childPrevious : childLive;
            }
            if (childResult !== childPrevious || isClassInstance(childLive)) {
                changed = true;
                ensure()[Number(freshKey)] = childResult;
            } else if (result !== undefined) {
                ensure()[Number(freshKey)] = childResult;
            }
            previousIndex++;
            freshIndex++;
        } else if (Number(previousKey) < Number(freshKey)) {
            changed = true;
            previousIndex++;
        } else {
            changed = true;
            ensure()[Number(freshKey)] =
                detachOpaqueInto(Reflect.get(live, freshKey), ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass);
            freshIndex++;
        }
    }
    if (!changed) {
        register(ctx, live, raw, previous);
        return previous;
    }
    ensure();
    remapArrayCycles(ctx, result, cycleEntries);
    register(ctx, live, raw, result);
    return result;
};

/** Points cycle back edges at the ancestor's own copy once its walk ended changed. */
const remapArrayCycles = (
    ctx: IContext,
    result: unknown[] | undefined,
    cycleEntries: Array<{index: number; value: unknown; raw: object}>
): void => {
    if (result === undefined) {
        return;
    }
    for (let index = 0; index < cycleEntries.length; index++) {
        const entry = cycleEntries[index];
        const fixed = ctx.copies.get(entry.raw);
        if (fixed !== undefined && fixed !== entry.value) {
            result[entry.index] = fixed;
        }
    }
};

/** Map reconcile by iteration order; object keys count as changed (full-copy path). */
const reconcileMap = (
    previous: Map<unknown, unknown>,
    live: object,
    raw: object,
    ctx: IContext
): unknown => {
    let changed = previous.size !== (raw as Map<unknown, unknown>).size;
    const copy = new Map<unknown, unknown>();
    register(ctx, live, raw, copy);
    const freshKeys = Map.prototype.keys.call(raw) as IterableIterator<unknown>;
    const cycleEntries: Array<{key: unknown; value: unknown; raw: object}> = [];
    Map.prototype.forEach.call(previous, (previousValue: unknown, previousKey: unknown): void => {
        const freshKey = freshKeys.next();
        if (freshKey.done) {
            changed = true;
            return;
        }
        if (!isMatchableKey(previousKey) || !isMatchableKey(freshKey.value) ||
            !sameValueZero(previousKey, freshKey.value)) {
            changed = true;
            copy.set(
                detachOpaqueInto(freshKey.value, ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass),
                detachOpaqueInto(
                    Map.prototype.get.call(raw, freshKey.value), ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass
                )
            );
            return;
        }
        const liveValue = Map.prototype.get.call(raw, previousKey);
        const cycleBefore = ctx.cycleCount;
        const resultValue = reconcile(previousValue, liveValue, rawOf(liveValue), ctx);
        if (ctx.cycleCount !== cycleBefore) {
            cycleEntries.push({key: previousKey, value: previousValue, raw: rawOf(liveValue)});
        }
        if (resultValue !== previousValue || isClassInstance(liveValue)) {
            changed = true;
        }
        copy.set(previousKey, resultValue);
    });
    // Whatever the fresh side still holds past the walk (a grown Map) is new content.
    while (true) {
        const rest = freshKeys.next();
        if (rest.done) {
            break;
        }
        changed = true;
        copy.set(
            detachOpaqueInto(rest.value, ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass),
            detachOpaqueInto(
                Map.prototype.get.call(raw, rest.value), ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass
            )
        );
    }
    if (!changed) {
        register(ctx, live, raw, previous);
        return previous;
    }
    for (let index = 0; index < cycleEntries.length; index++) {
        const entry = cycleEntries[index];
        const fixed = ctx.copies.get(entry.raw);
        if (fixed !== undefined && fixed !== entry.value) {
            copy.set(entry.key, fixed);
        }
    }
    return copy;
};

/** Set reconcile by iteration order; object members count as changed (full-copy path). */
const reconcileSet = (
    previous: Set<unknown>,
    live: object,
    raw: object,
    ctx: IContext
): unknown => {
    let changed = previous.size !== (raw as Set<unknown>).size;
    const copy = new Set<unknown>();
    register(ctx, live, raw, copy);
    const previousMembers = Set.prototype.values.call(previous) as IterableIterator<unknown>;
    const freshMembers = Set.prototype.values.call(raw) as IterableIterator<unknown>;
    while (true) {
        const previousMember = previousMembers.next();
        let freshMember = freshMembers.next();
        if (previousMember.done) {
            // A grown Set: everything past the previous members is new content — drain it all.
            while (!freshMember.done) {
                changed = true;
                copy.add(detachOpaqueInto(freshMember.value, ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass));
                freshMember = freshMembers.next();
            }
            break;
        }
        if (freshMember.done) {
            changed = true;
            break;
        }
        if (!isMatchableKey(previousMember.value) || !isMatchableKey(freshMember.value) ||
            !sameValueZero(previousMember.value, freshMember.value)) {
            changed = true;
            copy.add(detachOpaqueInto(freshMember.value, ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass));
            continue;
        }
        copy.add(previousMember.value);
    }
    if (!changed) {
        register(ctx, live, raw, previous);
        return previous;
    }
    return copy;
};

/**
 * The fused "compare + detach" of a selection against the snapshot already handed out (R34-02). Equivalent to
 * `sameSelection(previous, live) ? previous : detachOpaque(live)`, with structural sharing on top.
 *
 * Unchanged subtrees keep their previous references and only the changed spine is copied, so a memoized child keyed on
 * a nested object still bails out, and every live leaf is still read through the view so the read set stays complete.
 * Prototypes, key order, `length`, holes, sparse slots, `__proto__` own keys and Date/Map/Set content follow the rules
 * of `sameSelection`/`detachOpaque`; alias topology changes yield a fresh full copy through the pair maps.
 *
 * @param previous - the previous detached snapshot, or any previous value
 * @param live - the freshly read selection, possibly a read-proxy view
 * @param onLiveInstance - optional report fired for each live class instance handed over
 * @param onArraySubclass - optional rejection policy for Array subclasses
 * @returns the snapshot to hand out: `previous` when nothing changed
 */
export const reconcileSelection = <T>(
    previous: unknown,
    live: unknown,
    onLiveInstance?: TReportLiveInstance,
    onArraySubclass?: TArraySubclassGuard
): T => {
    const ctx: IContext = {
        copies: new WeakMap<object, unknown>(),
        previousToFresh: new WeakMap<object, object>(),
        freshToPrevious: new WeakMap<object, object>(),
        onLiveInstance,
        onArraySubclass,
        cycleCount: 0,
        open: new WeakSet<object>(),
    };
    return reconcile(previous, live, rawOf(live), ctx) as T;
};

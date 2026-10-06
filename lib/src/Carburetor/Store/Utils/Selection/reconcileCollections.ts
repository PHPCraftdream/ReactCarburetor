import {detachOpaqueInto} from "./detachCore";
import {liveViews} from "@/Carburetor/Store/Tracking/Proxy/liveViews";

interface IReconcileContext {
    copies: WeakMap<object, unknown>;
    previousCopies: WeakMap<object, unknown> | undefined;
    cycleCount: number;
    open: WeakSet<object>;
    onLiveInstance: ((instance: object) => void) | undefined;
    onArraySubclass: ((instance: object) => never) | undefined;
    previousToFresh: WeakMap<object, object>;
    freshToPrevious: WeakMap<object, object>;
    reconcile: (previous: unknown, live: unknown, raw: object, ctx: IReconcileContext) => unknown;
    rawOf: (value: unknown) => object;
    register: (ctx: IReconcileContext, live: object, raw: object, copy: unknown) => void;
    isClassInstance: (value: unknown) => boolean;
    isMatchableKey: (key: unknown) => boolean;
    onSharing: () => void;
}

const sameValueZero = (a: unknown, b: unknown): boolean =>
    a === b || (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b));

const createCollectionReconciler = () => {
    const reconcileMap = (
        previous: Map<unknown, unknown>, live: object, raw: object, ctx: IReconcileContext
    ): unknown => {
        let changed = previous.size !== (raw as Map<unknown, unknown>).size;
        const copy = new Map<unknown, unknown>();
        ctx.register(ctx, live, raw, copy);
        const readMember = (key: unknown): unknown => {
            if (liveViews.readTarget(live) === undefined) return Map.prototype.get.call(raw, key);
            const get = Reflect.get(live, 'get') as (this: unknown, k: unknown) => unknown;
            // A facade's `get` is a recording wrapper; a plain view proxy over a native root
            // hands back the bare intrinsic, which rejects the proxy as its receiver. Read raw.
            if (get === Map.prototype.get) return Map.prototype.get.call(raw, key);
            return get.call(live, key);
        };
        const freshKeys = Map.prototype.keys.call(raw) as IterableIterator<unknown>;
        const cycleEntries: Array<{key: unknown; value: unknown; raw: object}> = [];
        Map.prototype.forEach.call(previous, (previousValue: unknown, previousKey: unknown): void => {
            const freshKey = freshKeys.next();
            if (freshKey.done) { changed = true; return; }
            if (!ctx.isMatchableKey(previousKey) || !ctx.isMatchableKey(freshKey.value) ||
                !sameValueZero(previousKey, freshKey.value)) {
                changed = true;
                copy.set(detachOpaqueInto(freshKey.value, ctx.copies,
                    ctx.onLiveInstance, ctx.onArraySubclass, ctx.onSharing),
                    detachOpaqueInto(readMember(freshKey.value), ctx.copies,
                        ctx.onLiveInstance, ctx.onArraySubclass, ctx.onSharing));
                return;
            }
            const liveValue = readMember(previousKey);
            const cycleBefore = ctx.cycleCount;
            const child = ctx.reconcile(previousValue, liveValue, ctx.rawOf(liveValue), ctx);
            if (ctx.cycleCount !== cycleBefore) cycleEntries.push({key: previousKey, value: previousValue,
                raw: ctx.rawOf(liveValue)});
            if (child !== previousValue || ctx.isClassInstance(liveValue)) changed = true;
            copy.set(previousKey, child);
        });
        while (true) {
            const rest = freshKeys.next();
            if (rest.done) break;
            changed = true;
            copy.set(detachOpaqueInto(rest.value, ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass, ctx.onSharing),
                detachOpaqueInto(readMember(rest.value), ctx.copies,
                    ctx.onLiveInstance, ctx.onArraySubclass, ctx.onSharing));
        }
        for (let index = 0; index < cycleEntries.length; index++) {
            const entry = cycleEntries[index];
            const fixed = ctx.copies.get(entry.raw);
            if (fixed !== undefined && fixed !== entry.value) {
                copy.set(entry.key, fixed);
                if (entry.raw !== raw) changed = true;
            }
        }
        if (!changed) { ctx.register(ctx, live, raw, previous); return previous; }
        return copy;
    };
    const reconcileSet = (previous: Set<unknown>, live: object, raw: object, ctx: IReconcileContext): unknown => {
        let changed = previous.size !== (raw as Set<unknown>).size;
        const copy = new Set<unknown>();
        ctx.register(ctx, live, raw, copy);
        const oldMembers = Set.prototype.values.call(previous) as IterableIterator<unknown>;
        const newMembers = ((): IterableIterator<unknown> => {
            if (liveViews.readTarget(live) === undefined) return Set.prototype.values.call(raw);
            const values = Reflect.get(live, 'values') as (this: unknown) => IterableIterator<unknown>;
            // A facade's `values` is a recording wrapper; a plain view proxy hands back the bare
            // intrinsic, which rejects the proxy as its receiver. Read raw.
            if (values === Set.prototype.values) return Set.prototype.values.call(raw);
            return values.call(live);
        })();
        while (true) {
            const oldMember = oldMembers.next();
            let newMember = newMembers.next();
            if (oldMember.done) {
                while (!newMember.done) {
                    changed = true;
                    copy.add(detachOpaqueInto(newMember.value, ctx.copies,
                        ctx.onLiveInstance, ctx.onArraySubclass, ctx.onSharing));
                    newMember = newMembers.next();
                }
                break;
            }
            if (newMember.done) { changed = true; break; }
            if (!ctx.isMatchableKey(oldMember.value) || !ctx.isMatchableKey(newMember.value) ||
                !sameValueZero(oldMember.value, newMember.value)) {
                changed = true;
                copy.add(detachOpaqueInto(newMember.value, ctx.copies,
                    ctx.onLiveInstance, ctx.onArraySubclass, ctx.onSharing));
                continue;
            }
            copy.add(oldMember.value);
        }
        if (!changed) { ctx.register(ctx, live, raw, previous); return previous; }
        return copy;
    };
    return {reconcileMap, reconcileSet};
};

export {createCollectionReconciler};

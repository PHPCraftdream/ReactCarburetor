import {detachOpaqueInto} from "./detachCore";

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
        const freshKeys = Map.prototype.keys.call(raw) as IterableIterator<unknown>;
        const cycleEntries: Array<{key: unknown; value: unknown; raw: object}> = [];
        Map.prototype.forEach.call(previous, (previousValue: unknown, previousKey: unknown): void => {
            const freshKey = freshKeys.next();
            if (freshKey.done) { changed = true; return; }
            if (!ctx.isMatchableKey(previousKey) || !ctx.isMatchableKey(freshKey.value) ||
                !sameValueZero(previousKey, freshKey.value)) {
                changed = true;
                copy.set(detachOpaqueInto(freshKey.value, ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass),
                    detachOpaqueInto(Map.prototype.get.call(raw, freshKey.value), ctx.copies,
                        ctx.onLiveInstance, ctx.onArraySubclass));
                return;
            }
            const liveValue = Map.prototype.get.call(raw, previousKey);
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
            copy.set(detachOpaqueInto(rest.value, ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass),
                detachOpaqueInto(Map.prototype.get.call(raw, rest.value), ctx.copies,
                    ctx.onLiveInstance, ctx.onArraySubclass));
        }
        if (!changed) { ctx.register(ctx, live, raw, previous); return previous; }
        for (let index = 0; index < cycleEntries.length; index++) {
            const entry = cycleEntries[index];
            const fixed = ctx.copies.get(entry.raw);
            if (fixed !== undefined && fixed !== entry.value) copy.set(entry.key, fixed);
        }
        return copy;
    };
    const reconcileSet = (previous: Set<unknown>, live: object, raw: object, ctx: IReconcileContext): unknown => {
        let changed = previous.size !== (raw as Set<unknown>).size;
        const copy = new Set<unknown>();
        ctx.register(ctx, live, raw, copy);
        const oldMembers = Set.prototype.values.call(previous) as IterableIterator<unknown>;
        const newMembers = Set.prototype.values.call(raw) as IterableIterator<unknown>;
        while (true) {
            const oldMember = oldMembers.next();
            let newMember = newMembers.next();
            if (oldMember.done) {
                while (!newMember.done) {
                    changed = true;
                    copy.add(detachOpaqueInto(newMember.value, ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass));
                    newMember = newMembers.next();
                }
                break;
            }
            if (newMember.done) { changed = true; break; }
            if (!ctx.isMatchableKey(oldMember.value) || !ctx.isMatchableKey(newMember.value) ||
                !sameValueZero(oldMember.value, newMember.value)) {
                changed = true;
                copy.add(detachOpaqueInto(newMember.value, ctx.copies, ctx.onLiveInstance, ctx.onArraySubclass));
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

/**
 * Cross-format terminal ownership; neither a name nor an Error prototype is proof.
 *
 * Native deref checks WeakRef internal slots, not a copy-local instanceof/registry
 * or a foreign object's deref callback. Collected targets no longer prove ownership.
 *
 * @param error - Rejection to classify.
 * @param source - Cache that owns the automatic demand.
 * @param promise - Original load promise whose terminal rejection is expected.
 */
export const isCacheSupersededError = (error: unknown, source: object, promise: Promise<void>): boolean => {
    if (error === null || typeof error !== 'object') return false;
    try {
        const owner: unknown = Object.getOwnPropertyDescriptor(
            error, Symbol.for('carburetor.cache.superseded.v2'),
        )?.value;
        if (owner === null || typeof owner !== 'object') return false;
        const sourceRef: unknown = Object.getOwnPropertyDescriptor(owner, 'source')?.value;
        const promiseRef: unknown = Object.getOwnPropertyDescriptor(owner, 'promise')?.value;
        return WeakRef.prototype.deref.call(sourceRef as WeakRef<object>) === source
            && WeakRef.prototype.deref.call(promiseRef as WeakRef<object>) === promise;
    } catch {
        // Malformed/foreign provenance is not ours; readers still propagate its rejection.
        return false;
    }
};

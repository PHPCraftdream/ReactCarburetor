/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Count collection calls only inside synchronous work; restore even on failure.
export const countCollections = work => {
    let calls = 0;
    let sizeReads = 0;
    const restore = [];
    for (const prototype of [Map.prototype, WeakMap.prototype]) {
        for (const key of Reflect.ownKeys(prototype)) {
            if (key === 'constructor') continue;
            const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
            if (typeof descriptor.value === 'function') {
                const original = descriptor.value;
                Object.defineProperty(prototype, key, {...descriptor, value: function (...args) {
                    calls++;
                    return Reflect.apply(original, this, args);
                }});
                restore.push(() => Object.defineProperty(prototype, key, descriptor));
            } else if (key === 'size') {
                Object.defineProperty(prototype, key, {...descriptor, get: function () {
                    sizeReads++;
                    return Reflect.apply(descriptor.get, this, []);
                }});
                restore.push(() => Object.defineProperty(prototype, key, descriptor));
            }
        }
    }
    try {
        const result = work();
        return {calls, sizeReads, result};
    } finally {
        for (const reset of restore) reset();
    }
};

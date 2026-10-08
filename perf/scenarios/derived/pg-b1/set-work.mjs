/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Include constructor-driven add calls when a Set copies an iterable.
export const countSets = fn => {
    const NativeSet = globalThis.Set;
    const nativeAdd = NativeSet.prototype.add;
    let constructions = 0;
    let adds = 0;
    globalThis.Set = class extends NativeSet {
        constructor(...args) { super(...args); constructions++; }
    };
    NativeSet.prototype.add = function(value) { adds++; return nativeAdd.call(this, value); };
    try {
        const value = fn();
        return {constructions, adds, work: constructions + adds, value};
    } finally {
        globalThis.Set = NativeSet;
        NativeSet.prototype.add = nativeAdd;
    }
};

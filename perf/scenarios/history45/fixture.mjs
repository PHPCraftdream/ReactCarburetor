/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
import {load} from '../../harness/lib.mjs';

const {Carburetor, CarburetorHistory} = await load();

export {CarburetorHistory};

export class Store extends Carburetor {
    run(fn) { this.update(fn); }
}

/**
 * Counts the fold search's per-candidate work: pending patches carry a proxy around their
 * segments array, and every candidate the backward scan examines reads its length, its
 * every method and the compared indexes through that proxy. The proxy reference survives
 * the re-own of object patches inside onPatch, so object candidates are counted too. A
 * separate tap counts nextExists reads while onPatch runs (one per object patch built).
 */
export class FoldCountHistory extends CarburetorHistory {
    gate = false;
    scans = 0;
    taps = 0;
    onPatch(patch) {
        if (typeof patch !== 'symbol') {
            const descriptor = Object.getOwnPropertyDescriptor(patch, 'nextExists');
            if (descriptor && 'value' in descriptor && descriptor.configurable) {
                const owner = this;
                Object.defineProperty(patch, 'nextExists', {
                    enumerable: descriptor.enumerable, configurable: descriptor.configurable,
                    get() { if (owner.gate) owner.taps++; return descriptor.value; },
                });
                const segments = new Proxy(patch.segments, {
                    get(target, key) { if (owner.gate) owner.scans++; return Reflect.get(target, key); },
                });
                Object.defineProperty(patch, 'segments', {
                    enumerable: descriptor.enumerable, configurable: descriptor.configurable,
                    get() { return segments; },
                });
            }
        }
        this.gate = true;
        try { return super.onPatch(patch); } finally { this.gate = false; }
    }
}

export const countObjectKeys = fn => {
    const original = Object.keys;
    let calls = 0;
    let visits = 0;
    Object.keys = function (value) {
        calls++;
        visits += value !== null && typeof value === 'object' ? original(value).length : 0;
        return original(value);
    };
    try {
        return {result: fn(), calls, visits};
    } finally { Object.keys = original; }
};

/** Counts Object.prototype.hasOwnProperty calls inside fn (positional attribution loop work). */
export const countHasOwn = fn => {
    const original = Object.prototype.hasOwnProperty;
    let calls = 0;
    Object.prototype.hasOwnProperty = function (value) { calls++; return original.call(this, value); };
    try {
        return {result: fn(), calls};
    } finally { Object.prototype.hasOwnProperty = original; }
};

export const rowsOf = (n, fill) => Array.from({length: n}, (_, id) => ({id, n: fill ?? 0}));

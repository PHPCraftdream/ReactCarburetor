import {applyDiff} from "@/Carburetor/Store/Paths/Diff/applyDiff";

describe('applyDiff targeted gaps', () => {
    test('installs an own __proto__ key as data without changing the target prototype', () => {
        const previous: Record<string, unknown> = {};
        const next = JSON.parse('{"__proto__":{"safe":true}}') as Record<string, unknown>;
        const target: Record<string, unknown> = {};
        const originalPrototype = Object.getPrototypeOf(target);
        expect(applyDiff(target, previous, next)).toBe(true);
        expect(Object.getPrototypeOf(target)).toBe(originalPrototype);
        expect(Object.prototype.hasOwnProperty.call(target, '__proto__')).toBe(true);
        expect(target['__proto__']).toEqual({safe: true});
    });

    test('restores same-length array own-undefined versus hole changes', () => {
        const previous = [undefined];
        const next: unknown[] = Array.from({length: 1});
        Reflect.deleteProperty(next, '0');
        const target: unknown[] = [undefined];
        expect(applyDiff(target as unknown as Record<string, unknown>, previous, next)).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(target, 0)).toBe(false);
        const reverseTarget: unknown[] = Array.from({length: 1});
        Reflect.deleteProperty(reverseTarget, '0');
        expect(applyDiff(reverseTarget as unknown as Record<string, unknown>, next, previous)).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(reverseTarget, 0)).toBe(true);
        expect(reverseTarget[0]).toBeUndefined();
    });
});

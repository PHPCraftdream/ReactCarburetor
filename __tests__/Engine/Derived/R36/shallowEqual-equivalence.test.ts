import {shallowEqual} from '@/Carburetor/Component/shallowEqual';

const reference = (left: unknown, right: unknown): boolean => {
    if (Object.is(left, right)) return true;
    if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false;
    if (Array.isArray(left) && Array.isArray(right)) {
        if (left.length !== right.length) return false;
        return left.every((value, index) => Object.is(value, right[index]));
    }
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => key in b && Object.is(a[key], b[key]));
};

describe('shallowEqual allocation-free equivalence', () => {
    test('matches the prior implementation across representative and generated pairs', () => {
        const values: unknown[] = [null, undefined, NaN, 0, -0, [], [1, 2], [NaN, -0],
            {a: 1}, {a: 1, b: 2}, {a: undefined}, Object.assign(Object.create(null), {a: 1}),
            Object.create({inherited: 1}), {__proto__: null, x: 1},
            Object.assign(Object.create({inherited: 1}), {own: 2})];
        let seed = 197;
        const random = (): number => { seed = (seed * 48271) % 2147483647; return seed; };
        for (const a of values) {
            for (const b of values) {
                expect(shallowEqual(a, b)).toBe(reference(a, b));
            }
        }
        for (let i = 0; i < 500; i++) {
            const make = (): unknown => {
                if (random() % 3 === 0) return Array.from({length: random() % 12}, () => random() % 5);
                const value: Record<string, unknown> = {};
                const count = random() % 12;
                for (let j = 0; j < count; j++) value[`key${j}`] = random() % 7;
                return value;
            };
            const a = make();
            const b = make();
            expect(shallowEqual(a, b)).toBe(reference(a, b));
        }
    });
});

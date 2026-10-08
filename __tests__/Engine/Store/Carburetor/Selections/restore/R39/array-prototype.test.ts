import {Carburetor} from '@/Carburetor';

describe('R39-05 array restore prototypes', () => {
    test.each([null, Object.prototype])('restore retains array prototype %s with repeated occupants', prototype => {
        const a = {id: 0};
        const b = {id: 1};
        const rows = Object.setPrototypeOf([a, b, a], prototype) as typeof a[];
        const store = new Carburetor({rows});
        const next = Object.setPrototypeOf([b, a, a], prototype) as typeof a[];
        store.restore({rows: next});
        const restored = store.getData().rows;
        expect(Array.isArray(restored)).toBe(true);
        expect([restored[0].id, restored[1].id, restored[2].id]).toEqual([1, 0, 0]);
        expect(restored[1]).toBe(restored[2]);
        expect(Object.getPrototypeOf(restored)).toBe(prototype);
    });
});

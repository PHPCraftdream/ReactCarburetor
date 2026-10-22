import {test, expect} from '@rstest/core';
import * as Testing from '@/Testing';
import {createTestScope, flush} from '@/Testing';
import {Carburetor, carburetorToken} from '@/Carburetor';

class TestStore extends Carburetor<{count: number}> {}
const token = carburetorToken(() => new TestStore({count: 0}), 'testing-surface');

test('testing helpers are the only named exports', () => {
    expect(Object.keys(Testing).sort()).toEqual(['createTestClock', 'createTestScope', 'flush']);
});

test('a test scope accepts token overrides and disposes', () => {
    const store = new TestStore({count: 2});
    const scope = createTestScope([[token, store]]);
    expect(scope.get(token)).toBe(store);
    expect(() => flush(scope)).not.toThrow();
    scope.dispose();
});

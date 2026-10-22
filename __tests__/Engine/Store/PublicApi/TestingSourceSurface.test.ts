import * as Testing from '@/Testing';

/** The public subpath is deliberately limited to framework testing helpers. */
const TESTING_SURFACE = ['createTestClock', 'createTestScope', 'flush'].sort();

describe('testing source surface', () => {
    test('exports exactly the documented helpers', () => {
        expect(Object.keys(Testing).sort()).toEqual(TESTING_SURFACE);
    });
});

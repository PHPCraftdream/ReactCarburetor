import {flush, createTestScope} from '@/Testing';
import {CARBURETOR_FLUSH, CARBURETOR_PERSIST_DRAIN, SCOPE_TESTING_VISIT} from '@/Carburetor/Store/Utils/Models';

describe('flush', () => {
    test('drains persistence writes after a store-target flush', () => {
        let flushes = 0;
        let drained = 0;
        const target = {
            [CARBURETOR_FLUSH]: () => { flushes++; return true; },
            [CARBURETOR_PERSIST_DRAIN]: new Set([() => { drained++; }]),
        };
        flush(target as never);
        expect(flushes).toBe(1);
        expect(drained).toBe(1);
    });

    test('stops when all known stores are drained and drains their persistence writes', () => {
        let visits = 0;
        let flushes = 0;
        let drains = 0;
        const scope = createTestScope();
        const store = {
            [CARBURETOR_FLUSH]: () => { flushes++; return false; },
            [CARBURETOR_PERSIST_DRAIN]: new Set([() => { drains++; }]),
        };
        (scope as unknown as Record<symbol, (callback: (store: unknown) => void) => void>)[
            SCOPE_TESTING_VISIT
        ] = callback => {
            visits++;
            callback(store);
        };
        try {
            flush(scope);
            expect(visits).toBe(2);
            expect(flushes).toBe(1);
            expect(drains).toBe(1);
        } finally {
            scope[Symbol.dispose]();
        }
    });

    test('flushes stores discovered during a progressing round', () => {
        const scope = createTestScope();
        let firstCount = 0;
        let addedCount = 0;
        let visits = 0;
        const first = {[CARBURETOR_FLUSH]: () => ++firstCount === 1};
        const added = {[CARBURETOR_FLUSH]: () => { addedCount++; return false; }};
        const testScope = scope as unknown as Record<
            symbol,
            (callback: (store: unknown) => void) => void
        >;
        testScope[SCOPE_TESTING_VISIT] = callback => {
            visits++;
            callback(first);
            if (visits > 1) callback(added);
        };
        try {
            flush(scope);
            expect(firstCount).toBe(2);
            expect(addedCount).toBe(1);
            expect(visits).toBe(3);
        } finally {
            scope[Symbol.dispose]();
        }
    });
    test('throws after 50 pending rounds', () => {
        const scope = createTestScope();
        let flushes = 0;
        const store = {[CARBURETOR_FLUSH]: () => { flushes++; return true; }};
        (scope as unknown as Record<symbol, (callback: (store: unknown) => void) => void>)[
            SCOPE_TESTING_VISIT
        ] = callback => callback(store);
        try {
            expect(() => flush(scope)).toThrow('Testing flush exceeded 50 pending rounds');
            expect(flushes).toBe(50);
        } finally {
            scope[Symbol.dispose]();
        }
    });
});


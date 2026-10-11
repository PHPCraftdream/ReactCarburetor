import {createCacheSupersededError} from '@/Carburetor/Resource/createCacheSupersededError';
import {isCacheSupersededError} from '@/Carburetor/Resource/Cache/Reader/isCacheSupersededError';

describe('R42-R02 exact cache terminal provenance', () => {
    test('classification requires the original source and promise, not AbortError name', () => {
        const source = {};
        const promise = Promise.resolve();
        const error = createCacheSupersededError(source, promise);
        expect(error.name).toBe('AbortError');
        expect(isCacheSupersededError(error, source, promise)).toBe(true);
        expect(isCacheSupersededError(error, {}, promise)).toBe(false);
        expect(isCacheSupersededError(error, source, Promise.resolve())).toBe(false);
        const foreign = new Error('foreign');
        foreign.name = 'AbortError';
        expect(isCacheSupersededError(foreign, source, promise)).toBe(false);
        expect(isCacheSupersededError(null, source, promise)).toBe(false);
        expect(isCacheSupersededError('AbortError', source, promise)).toBe(false);
    });

    test('independently minted shared-symbol provenance does not require local prototypes', () => {
        const source = {};
        const promise = Promise.resolve();
        const sourceRef = new WeakRef(source);
        const promiseRef = new WeakRef(promise);
        // Internal slots remain valid without the local WeakRef prototype.
        Object.setPrototypeOf(sourceRef, null);
        Object.setPrototypeOf(promiseRef, null);
        const error = Object.create(null);
        Object.defineProperty(error, Symbol.for('carburetor.cache.superseded.v2'), {
            value: Object.freeze({source: sourceRef, promise: promiseRef}),
        });
        expect(isCacheSupersededError(error, source, promise)).toBe(true);
        expect(isCacheSupersededError(error, {}, promise)).toBe(false);
        expect(isCacheSupersededError(error, source, Promise.resolve())).toBe(false);
    });

    test('strong backlinks and duck-typed deref callbacks are not weak provenance', () => {
        const source = {};
        const promise = Promise.resolve();
        let calls = 0;
        for (const owner of [
            {source, promise},
            {source: {deref: () => { calls++; return source; }}, promise: new WeakRef(promise)},
            {source: new WeakRef(source), promise: {deref: () => { calls++; return promise; }}},
            null,
        ]) {
            const foreign = new Error('foreign');
            foreign.name = 'AbortError';
            Object.defineProperty(foreign, Symbol.for('carburetor.cache.superseded.v2'), {value: owner});
            expect(isCacheSupersededError(foreign, source, promise)).toBe(false);
        }
        expect(calls).toBe(0);
    });

    test('classification never invokes provenance accessors', () => {
        const source = {};
        const promise = Promise.resolve();
        let calls = 0;
        const error = new Error('foreign accessor');
        Object.defineProperty(error, Symbol.for('carburetor.cache.superseded.v2'), {
            get: () => { calls++; throw new Error('accessor'); },
        });
        expect(isCacheSupersededError(error, source, promise)).toBe(false);
        const owner = {get source() { calls++; throw new Error('owner accessor'); }, promise: new WeakRef(promise)};
        const nested = new Error('nested accessor');
        Object.defineProperty(nested, Symbol.for('carburetor.cache.superseded.v2'), {value: owner});
        expect(isCacheSupersededError(nested, source, promise)).toBe(false);
        expect(calls).toBe(0);
    });
});

/*
 * PHASE2 consumer lifetime control PLAN (not executed by this static suite):
 * - In isolated GC-enabled children for CJS/ESM development/production and mixed
 *   formats/duplicate installs, obtain a real pre-loader supersession via public
 *   load + Pending cancellation. Mount real hook/class automatic consumers from
 *   the selected distribution against physical/package copies of the cache; keep
 *   explicit load rejection separate from automatic cancellation handling.
 *   Explicit await/catch must retain named AbortError.
 * - Keep only the caught error strongly rooted; keep WeakRef probes for the cache,
 *   original load promise and a cache-owned payload. Unsubscribe/release readers,
 *   drop closures, resolutions, args, promises and caches after the setup returns.
 *   Across later jobs, bounded explicit-GC rounds (no artificial allocation
 *   pressure) probe whether all targets clear
 *   while the held error remains readable. Never deref a probe before GC in that
 *   job (WeakRef keeps dereferenced targets alive to the end of the job).
 * - Positive consumer lifetime control: intentionally hold cache + original
 *   promise; all relevant targets must remain live and exact classification must
 *   succeed from the other format/copy. Release those roots, keep the error, and
 *   repeat the collection check. Also hold a caller-captured resolution separately
 *   to prove intentional payload retention until that consumer root is released.
 * - Do not confuse live continuation/React roots or runner assertion histories
 *   with error backlinks. No GC latency/byte guarantee: bounded failure is evidence
 *   to investigate with root analysis, not proof of deterministic collection.
 * - Preserve automatic expected cancellation handling, wrong source/promise and
 *   foreign AbortError visibility, publication/callback failure visibility, and
 *   explicit rejection independently of lifetime checks. These unit cases cover
 *   identity and accessor safety, not collection. The real Node reader/copy controls
 *   are in Views/resource42/auto-load-child.mjs; extend those public paths with the
 *   isolated lifetime setup and later-job probes, not a private descriptor oracle.
 */

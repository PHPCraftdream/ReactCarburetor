import {EResourceStatus as S, ResourceCache} from '@/Carburetor';
import {deferred} from '../../../Resource/helpers';

const ready = (data: string) => ({status: S.Success, data, error: undefined,
    updatedAt: Date.now(), refreshing: false, invalidated: false, failed: false});

for (const maxEntries of [8, Infinity]) for (const kind of ['primitive', 'object']) {
    describe(`resource44 ready completion ${kind}, capacity ${maxEntries}`, () => {
        test.each([0, 8, 32])('%s fresh hits share void completion with independent async reactions', async (count) => {
            const args = kind === 'primitive' ? 'a' : {id: 'a'};
            const other = kind === 'primitive' ? 'b' : {id: 'b'};
            let calls = 0;
            let callbacks = 0;
            let reactions = 0;
            const cache = new ResourceCache<string, typeof args>(async () => { calls++; return 'loaded'; },
                {ttl: Infinity, maxEntries});
            cache.setData({entries: {[cache.resolve(args).key]: ready('a'), [cache.resolve(other).key]: ready('b')}});
            const id = cache.subscribe(() => { callbacks++; });
            try {
                const before = cache.getVersion();
                const promises = Array.from({length: count}, (_value, index) => cache.load(index % 2 ? other : args));
                const children = promises.map(promise => promise.then(value => {
                    expect(value).toBeUndefined();
                    reactions++;
                }));
                expect(reactions).toBe(0);
                expect(new Set(promises).size).toBe(count === 0 ? 0 : 1);
                expect(new Set(children).size).toBe(count);
                await Promise.all(children);
                expect(reactions).toBe(count);
                expect(calls).toBe(0);
                expect(callbacks).toBe(0);
                expect(cache.getVersion()).toBe(before);
                expect(cache.getEntry(args).data).toBe('a');
                expect(cache.getEntry(other).data).toBe('b');
            } finally { cache.unsubscribe(id); }
        });
    });
}

describe('resource44 ready isolation and real work', () => {
    test('callback throws reject only its child and caches do not share completions', async () => {
        const first = new ResourceCache<string, string>(async () => 'unexpected', {ttl: Infinity});
        const second = new ResourceCache<string, string>(async () => 'unexpected', {ttl: Infinity});
        first.setData({entries: {[first.resolve('a').key]: ready('first')}});
        second.setData({entries: {[second.resolve('a').key]: ready('second')}});
        const completion = first.load('a');
        expect(first.load('a')).toBe(completion);
        expect(second.load('a')).not.toBe(completion);
        const thrown = new Error('caller callback');
        let called = false;
        const bad = completion.then(() => { throw thrown; });
        const good = completion.then(() => { called = true; return 'independent'; });
        const rejected = expect(bad).rejects.toBe(thrown);
        expect(called).toBe(false);
        expect(good).not.toBe(bad);
        await rejected;
        expect(await good).toBe('independent');
        expect(await completion).toBeUndefined();
        expect(first.load('a')).toBe(completion);
    });

    test.each(['cold', 'forced', 'stale', 'invalidated'] as const)(
        '%s work has request-owned completions, pending joins and raw failure', async (lane) => {
            const gates = [deferred<string>(), deferred<string>()];
            let calls = 0;
            const cache = new ResourceCache<string, string>(() => gates[calls++].promise,
                {ttl: lane === 'stale' ? 0 : Infinity, maxEntries: 8});
            const a = cache.resolve('a').key;
            const b = cache.resolve('b').key;
            cache.setData({entries: {[a]: {...ready('a'), updatedAt: Date.now() + 60_000},
                [b]: {...ready('b'), updatedAt: Date.now() + 60_000}}});
            const completion = cache.load('a');
            await completion;
            if (lane === 'cold') cache.forgetAll();
            if (lane === 'stale') cache.setData({entries: {
                [a]: {...ready('a'), updatedAt: 0}, [b]: {...ready('b'), updatedAt: 0},
            }});
            if (lane === 'invalidated') cache.invalidateAll();
            const first = lane === 'forced' ? cache.refresh('a') : cache.load('a');
            const second = lane === 'forced' ? cache.refresh('b') : cache.load('b');
            expect(calls).toBe(2);
            expect(first).not.toBe(completion);
            expect(second).not.toBe(completion);
            expect(first).not.toBe(second);
            expect(cache.refresh('a')).toBe(first);
            expect(cache.refresh('b')).toBe(second);
            const raw = new Error('offline');
            gates[0].reject(raw);
            gates[1].resolve('current-b');
            await Promise.all([first, second]);
            expect(cache.getFailure('a')).toBe(raw);
            expect(cache.getEntry('a')).toMatchObject({error: 'offline', failed: true,
                status: lane === 'cold' ? S.Error : S.Success});
            expect(cache.getEntry('b')).toMatchObject({status: S.Success, data: 'current-b', error: undefined});
        }
    );
});

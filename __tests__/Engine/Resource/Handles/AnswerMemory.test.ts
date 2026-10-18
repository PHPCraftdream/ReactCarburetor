import {CarburetorHistory, EResourceStatus, ResourceCarburetor} from '@/Carburetor';
import {createAnswerMemory} from '@/Carburetor/Resource/Slot/answerMemory';

const sleep = async (ms: number): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, ms));
};

/** A loader that records every request and answers `answer-<key>`. */
const recorded = () => {
    const calls: string[] = [];
    const load = async (key: string): Promise<string> => {
        calls.push(key);
        return `answer-${key}`;
    };
    return {calls, load};
};

describe('ResourceCarburetor answer memory (D1)', () => {
    test('switching keys and back serves the remembered answer without a new request', async () => {
        const loader = recorded();
        const resource = new ResourceCarburetor<string, [string]>(loader.load);

        await resource.load('a');
        await resource.load('b');
        await resource.load('a');

        // The default ttl (30 s) keeps a remembered answer fresh (D4), so 'a' costs no request.
        expect(loader.calls).toEqual(['a', 'b']);
        expect(resource.getData().status).toBe(EResourceStatus.Success);
        expect(resource.getData().data).toBe('answer-a');
        expect(resource.suspend('b')).toBe('answer-b');
        expect(loader.calls).toEqual(['a', 'b']);
    });

    test('an expired ttl makes the remembered answer stale and load requests again', async () => {
        const loader = recorded();
        const resource = new ResourceCarburetor<string, [string]>(loader.load, {ttl: 40});

        await resource.load('a');
        await sleep(60);
        await resource.load('a');

        expect(loader.calls).toEqual(['a', 'a']);
        expect(resource.getData().data).toBe('answer-a');
    });

    test('maxEntries bounds the memory as a true LRU: re-reading keeps an entry resident', async () => {
        const loader = recorded();
        const resource = new ResourceCarburetor<string, [string]>(loader.load, {maxEntries: 2});

        await resource.load('a');
        await resource.load('b');
        await resource.load('a'); // re-read: 'a' becomes most-recent
        await resource.load('c'); // evicts the least-recently USED 'b' (FIFO would evict 'a')
        await resource.load('a'); // must be a memory hit, not a new request

        expect(loader.calls).toEqual(['a', 'b', 'c']);

        // 'c' is still remembered: reading it again costs nothing.
        await resource.load('c');
        expect(loader.calls).toEqual(['a', 'b', 'c']);
    });

    test('by default a repeat is served from memory, an expired ttl requests again (D4)', async () => {
        const freshLoader = recorded();
        const staleLoader = recorded();
        const fresh = new ResourceCarburetor<string, [string]>(freshLoader.load);
        const expiring = new ResourceCarburetor<string, [string]>(staleLoader.load, {ttl: 40});

        // By default (ttl 30 s) a fresh repeat never reaches the loader.
        await fresh.load('a');
        await sleep(60);
        await fresh.load('a');
        expect(freshLoader.calls).toEqual(['a']);

        // With a ttl the same repeat after expiry requests again.
        await expiring.load('a');
        await sleep(60);
        await expiring.load('a');
        expect(staleLoader.calls).toEqual(['a', 'a']);
    });

    test('clear() drops the whole memory, so the next load requests again', async () => {
        const loader = recorded();
        const resource = new ResourceCarburetor<string, [string]>(loader.load);

        await resource.load('a');
        resource.clear();

        expect(resource.getData().status).toBe(EResourceStatus.Idle);
        expect(resource.getData().data).toBeUndefined();

        await resource.load('a');
        expect(loader.calls).toEqual(['a', 'a']);
    });

    test('the default memory is bounded (LRU) and re-requests evicted keys', async () => {
        const loader = recorded();
        const resource = new ResourceCarburetor<string, [string]>(loader.load);

        for (let index = 0; index < 150; index++) await resource.load(`key-${index}`);
        // 100 is the default budget: key-0 was evicted long ago, key-149 is resident.
        const seeded = Array.from({length: 150}, (_, index) => `key-${index}`);
        await resource.load('key-0');
        expect(loader.calls).toEqual([...seeded, 'key-0']);

        await resource.load('key-149');
        expect(loader.calls).toEqual([...seeded, 'key-0']);
    });

    test('a stale entry is purged from the memory on read and on remember', async () => {
        const loader = recorded();
        const resource = new ResourceCarburetor<string, [string]>(loader.load, {ttl: 30});

        await resource.load('a');
        await sleep(60);
        // Reading 'a' past its ttl must not keep the expired entry alive: it is dropped,
        // not skipped, so the memory does not accumulate every expired answer.
        await resource.load('b');
        await sleep(60);
        await resource.load('c');

        expect(loader.calls).toEqual(['a', 'b', 'c']);
        // 'a' and 'b' expired and were never refreshed: nothing may resurrect them.
        await sleep(60);
        await resource.load('a');
        expect(loader.calls).toEqual(['a', 'b', 'c', 'a']);
    });

    test('explicit maxEntries: Infinity keeps every answer, 0 keeps none', async () => {
        const loader = recorded();
        const unlimited = new ResourceCarburetor<string, [string]>(loader.load, {maxEntries: Infinity});

        await unlimited.load('a');
        await unlimited.load('b');
        await unlimited.load('a'); // nothing is evicted, so 'a' is still a memory hit
        expect(loader.calls).toEqual(['a', 'b']);

        const zeroLoader = recorded();
        const zero = new ResourceCarburetor<string, [string]>(zeroLoader.load, {maxEntries: 0});
        await zero.load('a');
        await zero.load('b'); // 'a' is evicted immediately: nothing is remembered
        await zero.load('a'); // so 'a' costs a new request again
        expect(zeroLoader.calls).toEqual(['a', 'b', 'a']);
    });

    test('snapshot() carries only the current answer, never the memory', async () => {
        const loader = recorded();
        const resource = new ResourceCarburetor<string, [string]>(loader.load);
        // History must be attached before the first load so its Idle baseline is recorded.
        const history = new CarburetorHistory(resource);
        try {
            await resource.load('a');
            // The recorded history representation of 'a' carries only the wire fields.
            const historyA = JSON.stringify(resource.captureHistory(<V,>(value: V) => value));
            await resource.load('b');

            const snapshot = resource.snapshot();

        // The wire form names the current answer's key only; earlier answers are runtime-only.
        expect(Object.keys(snapshot).sort()).toEqual(
            ['data', 'error', 'isError', 'isIdle', 'isPending', 'isSuccess', 'key', 'status', 'updatedAt'].sort()
        );
        expect(snapshot).toEqual({
            ...snapshot, key: JSON.stringify('b'), data: 'answer-b',
        });
        expect(snapshot.key).toBe(JSON.stringify('b'));

        // toJSON(): the live data plus the settled key, no runtime memory either.
        const wire: Record<string, unknown> = JSON.parse(JSON.stringify(resource));
        // JSON drops undefined fields, so compare against the round-tripped snapshot.
        expect(Object.keys(wire).sort())
            .toEqual(Object.keys(JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>).sort());
        expect(wire.key).toBe(JSON.stringify('b'));
        expect(JSON.stringify(wire)).not.toContain('answer-a');

        // The history representation (captureHistory) owns the raw state graph: no memory there.
        const historyState = resource.captureHistory(<V,>(value: V) => value);
        expect(Object.keys(JSON.parse(JSON.stringify(historyState)) as Record<string, unknown>).sort())
            .toEqual(Object.keys(JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>).sort());
        expect(JSON.stringify(historyState)).not.toContain('answer-a');

        // Undo replays wire snapshots only: 'answer-a' never resurfaces as live memory.
        // The earlier 'a' state recorded for history is wire-only: its own answer, no memory.
        expect(historyA).toContain('answer-a');
        expect(Object.keys(JSON.parse(historyA) as Record<string, unknown>).sort())
            .toEqual(Object.keys(JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>).sort());

        expect(history.undo()).toBe(true);
        // The undo replays the recorded wire snapshot (back to the Idle baseline);
        // the settled key is runtime-only, so it is not part of the replayed form.
        expect(resource.getData().status).toBe(EResourceStatus.Idle);
        expect(JSON.stringify(resource)).toContain('answer-a');
        expect(Object.keys(JSON.parse(JSON.stringify(resource)) as Record<string, unknown>).sort())
            .toEqual(['data', 'isError', 'isIdle', 'isPending', 'isSuccess', 'status', 'updatedAt'].sort());
        // The remembered 'b' entry must not leak into the serialized form.
        expect(JSON.stringify(resource)).not.toContain('answer-b');
        expect(JSON.stringify(resource)).not.toContain('"b"');
        } finally {
            history.disconnect();
        }
    });
});

describe('answer memory retention', () => {
    test('an expired payload is deleted by the read itself, without a sweep', () => {
        const realNow = Date.now;
        let now = 1_000;
        Date.now = () => now;
        try {
            const memory = createAnswerMemory<string>(30, undefined);
            memory.remember('k1', 'a', now); // fresh at insert
            memory.remember('k2', 'b', now); // fresh at insert
            now = 5_000;                     // both expired; no remember has run since
            expect(memory.fresh('k1')).toBeUndefined();
            expect(memory.size()).toBe(1);   // deleted by THIS read; k2 untouched
            expect(memory.fresh('k2')).toBeUndefined();
            expect(memory.size()).toBe(0);
        } finally { Date.now = realNow; }
    });

    test('remember() sweeps every stale entry, including ones past a fresh entry', () => {
        const memory = createAnswerMemory<string>(30, undefined);
        memory.remember('e1', 'a', Date.now() - 1000);
        memory.remember('fresh', 'b', Date.now());
        memory.remember('e2', 'c', Date.now() - 2000);

        // Another fresh remember runs the sweep: both expired entries must be gone.
        memory.remember('late', 'd', Date.now());

        expect(memory.size()).toBe(2);
        expect(memory.fresh('e1')).toBeUndefined();
        expect(memory.fresh('e2')).toBeUndefined();
        expect(memory.fresh('fresh')).toEqual({data: 'b', updatedAt: memory.fresh('fresh')!.updatedAt});
    });
});

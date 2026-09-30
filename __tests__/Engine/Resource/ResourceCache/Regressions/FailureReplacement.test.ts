import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {IResourceEntry} from "@/Carburetor/Models/Resource";
import {ResourceCache} from "@/Carburetor/Resource/Cache/ResourceCache";

const replacement = (error: string): IResourceEntry<string> => ({
    status: EResourceStatus.Error, data: undefined, error, updatedAt: undefined,
    refreshing: false, invalidated: false, failed: true,
});

class EditableCache extends ResourceCache<string, string> {
    /** Exercise a subclass's publicly exposed draft mutation. */
    public rewrite(key: string, change: (entry: IResourceEntry<string>) => void): void {
        this.update((draft) => { change(draft.entries[this.keyOf(key)]); });
    }

    /** Exercise a whole-entry draft replacement rather than a field write. */
    public replaceEntry(key: string, entry: IResourceEntry<string>): void {
        this.update((draft) => { draft.entries[this.keyOf(key)] = entry; });
    }

    /** Exercise a subclass's opaque publication when a write bypasses draft tracking. */
    public publishOpaqueError(key: string, message: string): void {
        this.data.entries[this.keyOf(key)].error = message;
        this.emitUpdate();
    }
}

describe('cache failure ownership across replacement', () => {
    test('a new Error at the same key throws its own message, never the previous raw rejection', async () => {
        const old = new Error('old-raw');
        const cache = new ResourceCache<string, string>(() => Promise.reject(old));

        await cache.load('a');
        expect(cache.getFailure('a')).toBe(old);

        cache.setData({entries: {[cache.keyOf('a')]: replacement('replacement-message')}});

        expect(cache.getEntry('a').error).toBe('replacement-message');
        expect(cache.getFailure('a')).toBeUndefined();
        let thrown: unknown;
        try {
            cache.suspend('a');
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toBe('replacement-message');
        expect(thrown).not.toBe(old);
    });

    test('a Success replacement removes the old rejection and suspend serves its new value', async () => {
        const old = new Error('old-raw');
        const cache = new ResourceCache<string, string>(() => Promise.reject(old));

        await cache.load('a');
        const key = cache.keyOf('a');
        cache.setData({entries: {[key]: {
            ...replacement('unused'), status: EResourceStatus.Success, data: 'replacement',
            error: undefined, updatedAt: Date.now(), failed: false,
        }}});

        expect(cache.getFailure('a')).toBeUndefined();
        expect(cache.getEntry('a').status).toBe(EResourceStatus.Success);
        expect(cache.suspend('a')).toBe('replacement');
    });

    test('replacing another entry retains the current raw failure for an unchanged key', async () => {
        const old = new Error('first-raw');
        const cache = new ResourceCache<string, string>((key) => key === 'a'
            ? Promise.reject(old) : Promise.resolve(key));

        await Promise.all([cache.load('a'), cache.load('b')]);
        const {entries} = cache.getData();
        cache.setData({entries: {
            ...entries,
            [cache.keyOf('b')]: {...entries[cache.keyOf('b')], data: 'new-b'},
        }});

        expect(cache.getEntry('b').data).toBe('new-b');
        expect(cache.getEntry('a').error).toBe('first-raw');
        expect(cache.getFailure('a')).toBe(old);
        let thrown: unknown;
        try {
            cache.suspend('a');
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBe(old);
    });

    test('a same-key pending retry survives replacement and its eventual failure owns the entry', async () => {
        const old = new Error('old-raw');
        const pending = Promise.withResolvers<string>();
        let calls = 0;
        const cache = new ResourceCache<string, string>(() => ++calls === 1
            ? Promise.reject(old) : pending.promise);
        await cache.load('a');
        const request = cache.refresh('a');
        const key = cache.keyOf('a');

        cache.setData({entries: {[key]: {...cache.getData().entries[key]}}});
        expect(cache.getFailure('a')).toBeUndefined();
        expect(cache.getEntry('a').status).toBe(EResourceStatus.Pending);
        const current = new Error('current-raw');
        pending.reject(current);
        await request;

        expect(cache.getEntry('a').error).toBe('current-raw');
        expect(cache.getFailure('a')).toBe(current);
        let thrown: unknown;
        try {
            cache.suspend('a');
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBe(current);
    });

    test.each(['restore', 'fromJSON'] as const)('%s clears raw failures and normalizes Pending', async (method) => {
        const old = new Error('old-raw');
        const cache = new ResourceCache<string, string>(() => Promise.reject(old));

        await cache.load('a');
        const key = cache.keyOf('a');
        const snapshot = {entries: {[key]: replacement('restored-message')}};
        cache[method](snapshot);

        expect(cache.getFailure('a')).toBeUndefined();
        expect(cache.getEntry('a').error).toBe('restored-message');
        expect(() => cache.suspend('a')).toThrow('restored-message');

        cache[method]({entries: {[key]: {...replacement('unused'), status: EResourceStatus.Pending}}});
        expect(cache.getEntry('a').status).toBe(EResourceStatus.Idle);
        expect(cache.getFailure('a')).toBeUndefined();
    });
});

test.each(['a', 'a.b~c'])('Error rewrite for %s detaches raw rejection before observers run', async (key) => {
    const old = {reason: 'upstream rejected'};
    const cache = new EditableCache(() => Promise.reject(old));
    await cache.load(key);
    const messages: string[] = [];
    const id = cache.subscribe(() => {
        let thrown: unknown;
        try {
            cache.suspend(key);
        } catch (error: unknown) {
            thrown = error;
        }
        messages.push(`${cache.getEntry(key).error}:${cache.getFailure(key) === old}:` +
            `${thrown instanceof Error ? thrown.message : String(thrown)}`);
    }, {reads: new Set([cache.pathOf(key)])});

    cache.rewrite(key, (entry) => { entry.error = 'new serialized failure'; });
    expect(cache.getEntry(key).error).toBe('new serialized failure');
    expect(cache.serialize()).toContain('new serialized failure');
    expect(cache.getFailure(key)).toBeUndefined();
    expect(messages).toEqual(['new serialized failure:false:new serialized failure']);
    cache.unsubscribe(id);
});

test.each(['a', 'a.b~c'])('entry draft replacement clears raw error before delivery for %s', async (key) => {
    const old = new Error('same message');
    const other = new Error('other key');
    const cache = new EditableCache((args) => Promise.reject(args === key ? old : other));
    await Promise.all([cache.load(key), cache.load('other')]);
    const existing = cache.getData().entries[cache.keyOf(key)];
    const observations: Array<{failure: unknown; thrown: unknown; timestamp: number | undefined}> = [];
    const id = cache.subscribe(() => {
        let thrown: unknown;
        try {
            cache.suspend(key);
        } catch (error: unknown) {
            thrown = error;
        }
        observations.push({
            failure: cache.getFailure(key), thrown, timestamp: cache.getEntry(key).updatedAt,
        });
    }, {reads: new Set([cache.pathOf(key)])});

    cache.rewrite(key, (entry) => { entry.updatedAt = 3; });
    expect(cache.getData().entries[cache.keyOf(key)]).toBe(existing);
    expect(cache.getFailure(key)).toBe(old);
    expect(observations).toEqual([{failure: old, thrown: old, timestamp: 3}]);

    cache.replaceEntry(key, {...existing, updatedAt: 5});
    expect(cache.getData().entries[cache.keyOf(key)]).not.toBe(existing);
    expect(cache.getFailure(key)).toBeUndefined();
    expect(observations).toHaveLength(2);
    expect(observations[1].failure).toBeUndefined();
    expect(observations[1].timestamp).toBe(5);
    expect(observations[1].thrown).toBeInstanceOf(Error);
    expect((observations[1].thrown as Error).message).toBe('same message');
    expect(observations[1].thrown).not.toBe(old);
    expect(cache.getFailure('other')).toBe(other);
    cache.unsubscribe(id);
});

test('a distinct same-shape entry never inherits raw failure, even with no changed field path', async () => {
    const a = new Error('shared message');
    const b = new Error('shared message');
    const cache = new EditableCache((key) => Promise.reject(key === 'a' ? a : b));
    await Promise.all([cache.load('a'), cache.load('b')]);

    cache.setData(cache.getData());
    expect(cache.getFailure('a')).toBe(a);
    expect(cache.getFailure('b')).toBe(b);

    cache.replaceEntry('a', {...cache.getData().entries[cache.keyOf('a')]});
    cache.replaceEntry('b', {...cache.getData().entries[cache.keyOf('b')]});
    expect(cache.getFailure('a')).toBeUndefined();
    let thrown: unknown;
    try {
        cache.suspend('b');
    } catch (error: unknown) {
        thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('shared message');
    expect(thrown).not.toBe(b);
    expect(cache.getFailure('b')).toBeUndefined();
});

test.each([new Error('loader failure'), undefined, false])(
    'loader rejection %p remains raw during synchronous publication', async (raw) => {
        const cache = new ResourceCache<string, string>(() => Promise.reject(raw));
        const observed: Array<{failure: unknown; thrown: unknown; caught: boolean}> = [];
        const id = cache.subscribe(() => {
            if (cache.getEntry('a').status !== EResourceStatus.Error) {
                return;
            }
            let caught = false;
            let thrown: unknown;
            try {
                cache.suspend('a');
            } catch (error: unknown) {
                caught = true;
                thrown = error;
            }
            observed.push({failure: cache.getFailure('a'), caught, thrown});
        }, {reads: new Set([cache.pathOf('a')])});

        await cache.load('a');
        expect(observed).toEqual([{failure: raw, caught: true, thrown: raw}]);
        cache.unsubscribe(id);
    }
);

test('a published Error-to-Success rewrite clears only its own failure', async () => {
    const a = new Error('a failure');
    const b = new Error('b failure');
    const cache = new EditableCache((key) => Promise.reject(key === 'a' ? a : b), {ttl: Infinity});
    await Promise.all([cache.load('a'), cache.load('b')]);
    let delivered: unknown;
    const id = cache.subscribe(() => {
        delivered = cache.getFailure('a');
    }, {reads: new Set([cache.pathOf('a')])});

    cache.rewrite('a', (entry) => {
        entry.status = EResourceStatus.Success;
        entry.data = 'recovered';
        entry.error = undefined;
        entry.failed = false;
        entry.updatedAt = Date.now();
    });
    expect(delivered).toBeUndefined();
    expect(cache.getFailure('a')).toBeUndefined();
    expect(cache.suspend('a')).toBe('recovered');
    expect(cache.getFailure('b')).toBe(b);
    let thrown: unknown;
    try {
        cache.suspend('b');
    } catch (error: unknown) {
        thrown = error;
    }
    expect(thrown).toBe(b);
    cache.unsubscribe(id);
});

test('an opaque subclass publication reconciles raw errors before its wildcard delivery', async () => {
    const raw = new Error('raw transport');
    const cache = new EditableCache(() => Promise.reject(raw));
    await cache.load('a');
    let delivered: string | undefined;
    const id = cache.subscribe(() => {
        let thrown: unknown;
        try {
            cache.suspend('a');
        } catch (error: unknown) {
            thrown = error;
        }
        delivered = thrown instanceof Error ? thrown.message : String(thrown);
    }, {reads: new Set([cache.pathOf('a')])});

    cache.publishOpaqueError('a', 'opaque replacement');
    expect(delivered).toBe('opaque replacement');
    expect(cache.getFailure('a')).toBeUndefined();
    cache.unsubscribe(id);
});

test('a retry and its abort retain the prior raw failure until another answer owns the key', async () => {
    const raw = new Error('prior failure');
    const pending = Promise.withResolvers<string>();
    let calls = 0;
    const cache = new ResourceCache<string, string>(() => ++calls === 1
        ? Promise.reject(raw) : pending.promise);
    await cache.load('a');
    const retry = cache.refresh('a');

    expect(cache.getFailure('a')).toBe(raw);
    cache.abort('a');
    expect(cache.getFailure('a')).toBe(raw);
    expect(cache.getEntry('a')).toMatchObject({status: EResourceStatus.Idle, failed: true});
    pending.resolve('late answer');
    await retry;
    expect(cache.getFailure('a')).toBe(raw);
    expect(cache.getEntry('a').data).toBeUndefined();
});

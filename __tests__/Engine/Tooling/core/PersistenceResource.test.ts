import {
    Carburetor, CarburetorScope, carburetorToken, connectDevTools, EDevToolsAction, EDevToolsMessageType,
    EResourceStatus, IDevToolsConnection, IDevToolsMessage, IStorageLike, persist, ResourceCarburetor,
} from '@/Carburetor';

class MemoryStorage implements IStorageLike {
    public entries = new Map<string, string>();
    public writes = 0;

    public getItem(key: string): string | null {
        return this.entries.get(key) ?? null;
    }

    public setItem(key: string, value: string): void {
        this.writes++;
        this.entries.set(key, value);
    }

    public removeItem(key: string): void {
        this.entries.delete(key);
    }
}

const readThrown = (read: () => unknown): unknown => {
    try {
        read();
    } catch (error: unknown) {
        return error;
    }

    return undefined;
};

describe('persist resource serialization (R11-04)', () => {
    test.each([false, true])('restored success keeps its key, other keys load anew (coalesce=%s)', async coalesce => {
        const storage = new MemoryStorage();
        const source = new ResourceCarburetor<string, string>(async id => `answer-${id}`);
        const stop = persist(source, {key: 'slot', storage, coalesce});

        const request = source.load('a');
        if (coalesce) {
            expect(storage.getItem('slot')).toBeNull();
        }
        await request;
        if (!coalesce) {
            expect(JSON.parse(storage.getItem('slot') as string).status).toBe(EResourceStatus.Success);
        }
        stop(); // also flushes a coalesced settlement

        const saved = JSON.parse(storage.getItem('slot') as string);
        expect(saved.key).toBe(JSON.stringify('a'));
        expect(saved.status).toBe(EResourceStatus.Success);

        const calls: string[] = [];
        const fresh = new ResourceCarburetor<string, string>(async id => {
            calls.push(id);
            return `fresh-${id}`;
        });
        const disconnect = persist(fresh, {key: 'slot', storage});

        expect(fresh.suspend('a')).toBe('answer-a');
        expect(calls).toEqual([]);
        const pending = readThrown(() => fresh.suspend('b'));
        expect(pending).toBeInstanceOf(Promise);
        expect(calls).toEqual(['b']);
        await (pending as Promise<void>);
        expect(fresh.suspend('b')).toBe('fresh-b');
        disconnect();
        expect(JSON.parse(storage.getItem('slot') as string).key).toBe(JSON.stringify('b'));
    });

    test('restored failure is rethrown only for its key; disconnect stops persistence', async () => {
        const storage = new MemoryStorage();
        const source = new ResourceCarburetor<string, string>(async () => { throw new Error('offline'); });
        const disconnect = persist(source, {key: 'slot', storage});
        await source.load('a');
        disconnect();

        const saved = JSON.parse(storage.getItem('slot') as string);
        expect(saved.key).toBe(JSON.stringify('a'));
        expect(saved.error).toBe('offline');
        const writes = storage.writes;
        await source.load('b');
        expect(storage.writes).toBe(writes);
        expect(JSON.parse(storage.getItem('slot') as string)).toEqual(saved);

        const calls: string[] = [];
        const fresh = new ResourceCarburetor<string, string>(async id => {
            calls.push(id);
            return `online-${id}`;
        });
        const stopFresh = persist(fresh, {key: 'slot', storage});
        expect(readThrown(() => fresh.suspend('a'))).toMatchObject({message: 'offline'});
        expect(calls).toEqual([]);
        const pending = readThrown(() => fresh.suspend('b'));
        expect(pending).toBeInstanceOf(Promise);
        await (pending as Promise<void>);
        expect(fresh.suspend('b')).toBe('online-b');
        expect(calls).toEqual(['b']);
        expect(storage.writes).toBeGreaterThan(writes);
        stopFresh();
    });

    test('a persisted Pending snapshot normalizes to Idle without a phantom request', async () => {
        const storage = new MemoryStorage();
        let resolve!: (answer: string) => void;
        const source = new ResourceCarburetor<string, string>(() => new Promise<string>(r => { resolve = r; }));
        const disconnect = persist(source, {key: 'slot', storage});
        const request = source.load('a');
        const saved = JSON.parse(storage.getItem('slot') as string);
        expect(saved.status).toBe(EResourceStatus.Pending);
        expect(saved.key).toBeUndefined();
        disconnect();

        const calls: string[] = [];
        const fresh = new ResourceCarburetor<string, string>(async id => {
            calls.push(id);
            return `ready-${id}`;
        });
        const stopFresh = persist(fresh, {key: 'slot', storage});
        expect(fresh.getData().status).toBe(EResourceStatus.Idle);
        expect(calls).toEqual([]);
        const pending = readThrown(() => fresh.suspend('a'));
        expect(pending).toBeInstanceOf(Promise);
        await (pending as Promise<void>);
        expect(fresh.suspend('a')).toBe('ready-a');
        expect(calls).toEqual(['a']);
        resolve('old');
        await request;
        stopFresh();
    });

    test('scope and DevTools still round-trip the keyed answer through toJSON/fromJSON', async () => {
        const token = carburetorToken(
            () => new ResourceCarburetor<string, string>(async id => `loaded-${id}`),
            'persistence-resource-control'
        );
        const server = new CarburetorScope();
        await server.get(token).load('a');
        const wire = JSON.parse(JSON.stringify(server.dehydrate()));
        expect(wire[token.id].key).toBe(JSON.stringify('a'));

        const client = new CarburetorScope();
        client.hydrate(wire, [token]);
        expect(client.get(token).suspend('a')).toBe('loaded-a');

        let receive: ((message: IDevToolsMessage) => void) | undefined;
        let initial: unknown;
        const connection: IDevToolsConnection = {
            init: state => { initial = state; },
            send: () => undefined,
            subscribe: callback => {
                receive = callback;
                return () => { receive = undefined; };
            },
        };
        const resource = client.get(token);
        const disconnect = connectDevTools({slot: resource}, {extension: {connect: () => connection}});
        expect(initial).toEqual({slot: wire[token.id]});
        receive?.({
            type: EDevToolsMessageType.Dispatch,
            payload: {type: EDevToolsAction.JumpToAction, actionId: 1},
            state: JSON.stringify({slot: wire[token.id]}),
        });
        expect(resource.suspend('a')).toBe('loaded-a');
        disconnect();
    });

    test('a subtype controls its wire representation without forcing ordinary-store snapshots', () => {
        class EncodedStore extends Carburetor<{value: number}> {
            public serialize(): string {
                return JSON.stringify({value: this.getData().value + 100});
            }
            public restore(data: {value: number}): void {
                super.restore({value: data.value - 100});
            }
        }

        const storage = new MemoryStorage();
        const custom = new EncodedStore({value: 1});
        const stopCustom = persist(custom, {key: 'custom', storage});
        custom.setData({value: 2});
        expect(JSON.parse(storage.getItem('custom') as string)).toEqual({value: 102});
        stopCustom();
        const restored = new EncodedStore({value: 0});
        const stopRestored = persist(restored, {key: 'custom', storage});
        expect(restored.getData().value).toBe(2);
        stopRestored();

        class SnapshotGuard extends Carburetor<{branch: {value: number}}> {
            public snapshot(): {branch: {value: number}} {
                throw new Error('persistence must not clone the ordinary store');
            }
        }
        const ordinary = new SnapshotGuard({branch: {value: 0}});
        const stop = persist(ordinary, {key: 'ordinary', storage});
        ordinary.setData({branch: {value: 1}});
        expect(JSON.parse(storage.getItem('ordinary') as string)).toEqual({branch: {value: 1}});
        stop();
    });
});

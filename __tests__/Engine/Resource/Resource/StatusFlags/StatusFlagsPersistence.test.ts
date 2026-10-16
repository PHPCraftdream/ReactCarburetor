import {EResourceStatus, IStorageLike, persist, ResourceCarburetor} from '@/Carburetor';
import {IResourceSnapshot} from '@/Carburetor/Models/Resource';

/** Asserts exactly one status flag is true and it is the one the explicit table expects. */
const expectFlags = (
    data: {status: EResourceStatus; isIdle?: boolean; isPending?: boolean; isSuccess?: boolean; isError?: boolean},
    expected: 'isIdle' | 'isPending' | 'isSuccess' | 'isError',
): void => {
    const flags = {
        isIdle: data.isIdle === true, isPending: data.isPending === true,
        isSuccess: data.isSuccess === true, isError: data.isError === true,
    };
    const expectedMap: Record<EResourceStatus, 'isIdle' | 'isPending' | 'isSuccess' | 'isError'> = {
        [EResourceStatus.Idle]: 'isIdle', [EResourceStatus.Pending]: 'isPending',
        [EResourceStatus.Success]: 'isSuccess', [EResourceStatus.Error]: 'isError',
    };
    const trueFlags = Object.entries(flags).filter(([, value]) => value).map(([name]) => name);
    expect(trueFlags).toEqual([expected]);
    expect(expectedMap[data.status]).toBe(expected);
};

const memoryStorage = (): {storage: IStorageLike; entries: Map<string, string>} => {
    const entries = new Map<string, string>();
    return {
        entries,
        storage: {
            getItem: key => entries.get(key) ?? null,
            setItem: (key, value) => { entries.set(key, value); },
            removeItem: key => { entries.delete(key); },
        },
    };
};

describe('resource status flags across persistence', () => {
    test('persist writes a snapshot whose flags match status after load -> success', async () => {
        const resource = new ResourceCarburetor<string, [string]>(async () => 'answer');
        const {storage, entries} = memoryStorage();
        const stop = persist(resource, {key: 'slot', storage, coalesce: false});

        await resource.load('a');
        const parsed = JSON.parse(entries.get('slot') as string) as IResourceSnapshot<string>;
        expect(parsed.status).toBe(EResourceStatus.Success);
        expectFlags(parsed, 'isSuccess');
        stop();
    });

    test('a legacy stored payload without flag fields hydrates flags from status', () => {
        const {entries} = memoryStorage();
        entries.set('slot', JSON.stringify({
            status: EResourceStatus.Error, data: undefined, error: 'offline',
            updatedAt: 1, key: JSON.stringify('a'),
        }));

        const fresh = new ResourceCarburetor<string, [string]>(async () => 'unused');
        fresh.fromJSON(JSON.parse(entries.get('slot') as string));
        expectFlags(fresh.getData(), 'isError');
        expect(fresh.getData()).toMatchObject({isError: true, isSuccess: false});
    });

    test('contradicting stored flags are ignored in favor of status', () => {
        const {entries} = memoryStorage();
        entries.set('slot', JSON.stringify({
            status: EResourceStatus.Success, isIdle: true, isPending: true,
            isSuccess: false, isError: true, data: 'saved', error: undefined,
            updatedAt: 2, key: JSON.stringify('a'),
        }));

        const fresh = new ResourceCarburetor<string, [string]>(async () => 'unused');
        fresh.fromJSON(JSON.parse(entries.get('slot') as string));
        expectFlags(fresh.getData(), 'isSuccess');
        expect(fresh.getData()).toMatchObject({isSuccess: true, data: 'saved'});
    });

    test('persist -> hydrate into a fresh resource restores flags without re-running the loader', async () => {
        const calls: string[] = [];
        const resource = new ResourceCarburetor<string, [string]>(async key => {
            calls.push(key);
            return `answer-${key}`;
        });
        const {storage, entries} = memoryStorage();
        const stop = persist(resource, {key: 'slot', storage, coalesce: false});
        await resource.load('a');
        const saved = entries.get('slot') as string;
        stop();

        const fresh = new ResourceCarburetor<string, [string]>(async key => {
            calls.push(key);
            return 'nope';
        });
        fresh.fromJSON(JSON.parse(saved));
        expectFlags(fresh.getData(), 'isSuccess');
        expect(fresh.suspend('a')).toBe('answer-a');
        expect(calls).toEqual(['a']);
    });
});

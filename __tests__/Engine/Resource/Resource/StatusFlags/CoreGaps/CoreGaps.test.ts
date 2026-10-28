import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {IResourceData, IResourceResolution} from '@/Carburetor/Models/Resource';
import {ResourceCarburetor} from '@/Carburetor/Resource/ResourceCarburetor';
import {validateResourceLimits} from '@/Carburetor/Resource/validateResourceLimits';
import {createResourceFieldView} from '@/Carburetor/Resource/Cache/Reader/createResourceFieldView';
import {resourceReader} from '@/Carburetor/Resource/Cache/Reader/resourceReader';
import {prepareSlotPublication} from '@/Carburetor/Resource/Keys/prepareSlotPublication';
import {createAnswerMemory} from '@/Carburetor/Resource/Slot/answerMemory';

describe('ResourceCarburetor', () => {
    test('refresh rejects a key encoder failure without invoking the loader', async () => {
        const failure = new Error('bad key');
        let calls = 0;
        const resource = new ResourceCarburetor<string, [string]>(async () => { calls++; return 'ok'; }, {
            key: () => { throw failure; },
        });
        await expect(resource.refresh('x')).rejects.toBe(failure);
        expect(calls).toBe(0);
    });
});

describe('prepareSlotPublication', () => {
    test('accessor state falls back without replacing state', () => {
        const state: any = {data: undefined, error: undefined, updatedAt: undefined,
            isIdle: false, isPending: true, isSuccess: false, isError: false};
        Object.defineProperty(state, 'status', {get: () => EResourceStatus.Pending, enumerable: true});
        expect(prepareSlotPublication(state, {status: EResourceStatus.Idle, data: undefined,
            error: undefined, updatedAt: undefined})).toBeUndefined();
    });

    test('clones readonly state with settled fields', () => {
        const state = {status: EResourceStatus.Pending, data: undefined, error: undefined, updatedAt: undefined,
            isIdle: false, isPending: true, isSuccess: false, isError: false} as IResourceData<string>;
        Object.defineProperty(state, 'status', {value: state.status, writable: false, configurable: true,
            enumerable: true});
        const next = prepareSlotPublication(state, {status: EResourceStatus.Success, data: 'done',
            error: undefined, updatedAt: 4});
        expect(next).toMatchObject({status: EResourceStatus.Success, data: 'done', updatedAt: 4, isSuccess: true});
        expect(next).not.toBe(state);
        expect(state.status).toBe(EResourceStatus.Pending);
    });
});

describe('resourceReader', () => {
    test('collection falls back to entry path without a field facade', () => {
        const records: string[] = [];
        resourceReader.collect({path: 'entry', view: {} as any, present: true} as IResourceResolution<unknown>,
            path => records.push(path));
        expect(records).toEqual(['entry']);
    });
});

describe('createResourceFieldView', () => {
    test('field facade records reads and rejects defineProperty', () => {
        const records: string[] = [];
        const view = {status: EResourceStatus.Success, data: 'value', error: undefined,
            updatedAt: 1, invalidated: false, refreshing: false, stale: false} as any;
        const resolution = {path: 'entry', view} as IResourceResolution<string>;
        const facade = createResourceFieldView(resolution, path => records.push(path));
        expect(facade.data).toBe('value');
        expect(records).toContain(resourceReader.fieldPath('entry' as any, 'data'));
        expect(() => Object.defineProperty(facade, 'data', {value: 'changed'})).toThrow(TypeError);
    });
});

describe('createAnswerMemory', () => {
    test('expires entries and enforces LRU capacity', () => {
        const memory = createAnswerMemory<string>(Infinity, 2);
        memory.remember('a', 'A', Date.now());
        memory.remember('b', 'B', Date.now());
        expect(memory.fresh('a')?.data).toBe('A');
        memory.remember('c', 'C', Date.now());
        expect(memory.fresh('b')).toBeUndefined();
        expect(memory.size()).toBe(2);
        const expiring = createAnswerMemory<string>(0, Infinity);
        expiring.remember('old', 'old', Date.now() - 1);
        expect(expiring.fresh('old')).toBeUndefined();
        expect(expiring.size()).toBe(0);
    });
});

describe('validateResourceLimits', () => {
    test.each([
        [-1, undefined, 'ttl'], [Number.NaN, undefined, 'ttl'],
        [undefined, -1, 'maxEntries'], [undefined, 1.5, 'maxEntries'],
    ])('rejects invalid resource limits (%s, %s)', (ttl, maxEntries, field) => {
        expect(() => validateResourceLimits(ttl as number | undefined, maxEntries as number | undefined))
            .toThrow(new RangeError(`ResourceCarburetor ${field} must be a non-negative ` +
                `${field === 'ttl' ? 'number' : 'integer or Infinity'}`));
    });
});

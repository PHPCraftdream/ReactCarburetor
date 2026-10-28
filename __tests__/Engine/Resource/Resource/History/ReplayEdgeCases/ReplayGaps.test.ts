import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {IResourceEntry} from '@/Carburetor/Models/Resource';
import {normalizeOwnedCacheReplay} from '@/Carburetor/Resource/Cache/State/normalizeOwnedCacheReplay';
import {restoreSlotData} from '@/Carburetor/Resource/Slot/restoreSlotData';
import {resourceStatusFlags} from '@/Carburetor/Resource/Status/resourceStatusFlags';

const entry = (status: EResourceStatus): IResourceEntry<string> => ({
    ...resourceStatusFlags(status), status, refreshing: false, data: 'value', error: undefined,
    updatedAt: 1, invalidated: false, failed: false,
});

const lock = (owner: object, key: string, configurable = false): void => {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key)!;
    Object.defineProperty(owner, key, {...descriptor, writable: false, configurable});
};

describe('normalizeOwnedCacheReplay', () => {
    test('owned replay reinstalls live values for a missing dictionary slot', () => {
        const captured = {entries: {keep: entry(EResourceStatus.Success)}};
        const live = entry(EResourceStatus.Pending);
        const result = normalizeOwnedCacheReplay(captured, {later: live}, new Map([['later', live]]));
        expect(result.entries.later).toBe(live);
        expect(result.entries.keep.status).toBe(EResourceStatus.Success);
        expect(captured.entries).toBe(result.entries);
    });

    test('owned replay copies a nonconfigurable readonly captured slot before replacing it', () => {
        const old = entry(EResourceStatus.Success);
        const captured = {entries: {a: old}};
        lock(captured.entries, 'a');
        const live = entry(EResourceStatus.Pending);
        const liveDictionary = {};
        const result = normalizeOwnedCacheReplay(captured, liveDictionary, new Map([['a', live]]));
        expect(result).not.toBe(captured);
        expect(result.entries.a).toBe(live);
        expect(captured.entries.a).toBe(old);
        expect(Object.getOwnPropertyDescriptor(captured.entries, 'a')).toMatchObject({
            value: old, writable: false, configurable: false,
        });
        expect(Object.getOwnPropertyDescriptor(result.entries, 'a')).toMatchObject({value: live});
    });

    test('owned replay replaces a readonly configurable slot in place from the live descriptor', () => {
        const old = entry(EResourceStatus.Success);
        const captured = {entries: {a: old}};
        lock(captured.entries, 'a', true);
        const live = entry(EResourceStatus.Pending);
        const liveDictionary = {a: live};
        Object.defineProperty(liveDictionary, 'a', {
            value: live, enumerable: false, writable: false, configurable: true,
        });
        const result = normalizeOwnedCacheReplay(captured, liveDictionary, new Map([['a', live]]));
        expect(result.entries).toBe(captured.entries);
        expect(result.entries.a).toBe(live);
    });

    test('owned replay updates a writable existing slot in place', () => {
        const captured = {entries: {a: entry(EResourceStatus.Success)}};
        const live = entry(EResourceStatus.Pending);
        const result = normalizeOwnedCacheReplay(captured, {a: live}, new Map([['a', live]]));
        expect(result).toBe(captured);
        expect(result.entries.a).toBe(live);
    });

});

describe('restoreSlotData', () => {
    test('owned slot restore repairs a configurable readonly wrong flag without losing its descriptor', () => {
        const snapshot = {...resourceStatusFlags(EResourceStatus.Success), status: EResourceStatus.Success,
            data: 'value', error: undefined, updatedAt: 1, key: 'old'};
        lock(snapshot, 'isIdle', true);
        const result = restoreSlotData(snapshot, EResourceStatus.Idle, true);
        expect(result).toBe(snapshot);
        expect(result.status).toBe(EResourceStatus.Idle);
        expect(result.isIdle).toBe(true);
        expect(Object.getOwnPropertyDescriptor(result, 'isIdle')).toMatchObject({writable: false, configurable: true});
        expect('key' in result).toBe(false);
    });
});

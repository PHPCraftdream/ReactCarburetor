import {EResourceStatus as S, ResourceCache, ResourceCarburetor} from '@/Carburetor';
import {resourceStatusFlags} from '@/Carburetor/Resource/Status/resourceStatusFlags';

const rejection = (style: string, describe: () => string): unknown => style === 'object'
    ? {toString: describe} : Object.defineProperty(new Error('unused'), 'message', {get: describe});

for (const style of ['object', 'getter']) {
    describe(`resource44 throwing description: ${style}`, () => {
        test('thrown description rejects and leaves safe error state', async () => {
            const thrown = new Error('description threw');
            const raw = rejection(style, () => { throw thrown; });
            const cache = new ResourceCache<string, string>(() => Promise.reject(raw));
            const slot = new ResourceCarburetor<string, string>(() => Promise.reject(raw));
            const cacheRejected = expect(cache.load('a')).rejects.toBe(thrown);
            const slotRejected = expect(slot.load('a')).rejects.toBe(thrown);
            await Promise.all([cacheRejected, slotRejected]);
            expect(cache.getEntry('a').status).toBe(S.Error);
            expect(slot.getData().status).toBe(S.Error);
            expect(typeof cache.getEntry('a').error).toBe('string');
            expect(cache.getEntry('a').error.length).toBeGreaterThan(0);
            expect(typeof slot.getData().error).toBe('string');
            expect(slot.getData().error.length).toBeGreaterThan(0);
            expect(cache.getFailure('a')).toBe(raw);
            expect(slot.getLastError()).toBe(raw);
            let cacheThrew = false;
            let slotThrew = false;
            try { cache.suspend('a'); } catch (error) { cacheThrew = true; expect(error).toBe(raw); }
            try { slot.suspend('a'); } catch (error) { slotThrew = true; expect(error).toBe(raw); }
            expect(cacheThrew).toBe(true);
            expect(slotThrew).toBe(true);
        });
    });
}

describe('resource44 description reentry and throw', () => {
    test('slot load still rejects with the description error when the description restores another root', async () => {
        const sentinel = new Error('description threw');
        const snapshot = {...resourceStatusFlags(S.Success), status: S.Success, data: 'replacement', error: undefined,
            updatedAt: Date.now(), refreshing: false, invalidated: false, failed: false, key: JSON.stringify('b')};
        const slot = new ResourceCarburetor<string, string>(() => Promise.reject({
            toString: () => { slot.restore(snapshot); throw sentinel; },
        }));
        await expect(slot.load('a')).rejects.toBe(sentinel);
        expect(slot.getData()).toMatchObject({status: S.Success, data: 'replacement'});
    });
});

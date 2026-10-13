import {EResourceStatus as S, ResourceCache, ResourceCarburetor} from '@/Carburetor';
import {deferred} from '../../../Resource/helpers';

const ready = (data: string) => ({status: S.Success, data, error: undefined,
    updatedAt: Date.now(), refreshing: false, invalidated: false, failed: false});
const rejection = (style: string, describe: () => string): unknown => style === 'object'
    ? {toString: describe} : Object.defineProperty(new Error('unused'), 'message', {get: describe});

for (const style of ['object', 'getter']) {
    describe(`resource44 acceptance controls: ${style}`, () => {
        test('readonly invalidation COW during description accepts failure on the current entry', async () => {
            const gate = deferred<string>();
            let signal!: AbortSignal;
            const cache = new ResourceCache<string, string>((_args, requestSignal) => {
                signal = requestSignal;
                return gate.promise;
            }, {ttl: Infinity});
            const key = cache.resolve('a').key;
            const entry = ready('held');
            cache.setData({entries: {[key]: entry}});
            const first = cache.refresh('a');
            const operationalEntry = cache.getData().entries[key];
            Object.defineProperty(operationalEntry, 'invalidated',
                {value: false, writable: false, configurable: false});
            const held = cache.getData();
            const captured = cache.resolve('a');
            const raw = rejection(style, () => { cache.invalidate('a'); return 'offline'; });
            gate.reject(raw);
            await first;
            expect(cache.getData()).not.toBe(held);
            expect(held.entries[key]).toBe(operationalEntry);
            expect(cache.getData().entries[key]).not.toBe(operationalEntry);
            expect(held.entries[key]).toMatchObject({status: S.Success, data: 'held',
                invalidated: false, error: undefined, failed: false, refreshing: true});
            expect(Object.getOwnPropertyDescriptor(operationalEntry, 'invalidated'))
                .toMatchObject({writable: false, configurable: false});
            expect(signal.aborted).toBe(false);
            expect(held.entries[key].invalidated).toBe(false);
            expect(cache.getEntry('a')).toMatchObject({status: S.Success, data: 'held', error: 'offline',
                invalidated: true, failed: true, refreshing: false});
            expect(cache.getFailure('a')).toBe(raw);
            expect(captured.view).toMatchObject({data: 'held', invalidated: false, error: undefined, refreshing: true});
        });

        test('setData before settlement preserves active cache and slot failure acceptance', async () => {
            const cacheGate = deferred<string>();
            const slotGate = deferred<string>();
            const cache = new ResourceCache<string, string>(() => cacheGate.promise, {ttl: Infinity});
            const slot = new ResourceCarburetor<string, string>(() => slotGate.promise);
            const cacheLoad = cache.load('a');
            const slotLoad = slot.load('a');
            const key = cache.resolve('a').key;
            cache.setData({entries: {[key]: ready('manual')}});
            slot.setData(ready('manual'));
            const raw = rejection(style, () => 'offline');
            cacheGate.reject(raw);
            slotGate.reject(raw);
            await Promise.all([cacheLoad, slotLoad]);
            expect(cache.getEntry('a')).toMatchObject({status: S.Success, data: 'manual',
                error: 'offline', failed: true});
            expect(slot.getData()).toMatchObject({status: S.Error, data: 'manual', error: 'offline'});
            expect(cache.getFailure('a')).toBe(raw);
            expect(slot.getLastError()).toBe(raw);
        });

        test('setData inside description uses replacement data and status, not captured flags', async () => {
            const gate = deferred<string>();
            const cache = new ResourceCache<string, string>(() => gate.promise);
            const first = cache.load('a');
            const key = cache.resolve('a').key;
            const raw = rejection(style, () => {
                cache.setData({entries: {[key]: ready('manual')}});
                return 'offline';
            });
            gate.reject(raw);
            await first;
            expect(cache.getEntry('a')).toMatchObject({status: S.Success, data: 'manual',
                error: 'offline', failed: true});
            expect(cache.getFailure('a')).toBe(raw);
        });

        test('conversion exceptions reject explicit callers and cache can start another request', async () => {
            const thrown = new Error('description threw');
            const cacheGate = deferred<string>();
            const slotGate = deferred<string>();
            let calls = 0;
            const cache = new ResourceCache<string, string>(() => ++calls === 1 ? cacheGate.promise : Promise.resolve('next'));
            const slot = new ResourceCarburetor<string, string>(() => slotGate.promise);
            const first = cache.load('a');
            const slotFirst = slot.load('a');
            const raw = rejection(style, () => { throw thrown; });
            const cacheRejected = expect(first).rejects.toBe(thrown);
            const slotRejected = expect(slotFirst).rejects.toBe(thrown);
            cacheGate.reject(raw);
            slotGate.reject(raw);
            await Promise.all([cacheRejected, slotRejected]);
            expect(cache.getEntry('a')).toMatchObject({status: S.Error, error: 'Carburetor: resource failed'});
            expect(slot.getData()).toMatchObject({status: S.Error, error: 'Carburetor: resource failed'});
            await cache.refresh('a');
            expect(calls).toBe(2);
            expect(cache.getEntry('a').data).toBe('next');
            slot.abort();
        });
    });
}

describe('resource44 terminal controls', () => {
    test('slot abort listener restored root survives late failure', async () => {
        const gate = deferred<string>();
        const slot = new ResourceCarburetor<string, string>((_args, signal) => {
            signal.addEventListener('abort', () => slot.restore({...ready('replacement'), key: JSON.stringify('b')}),
                {once: true});
            return gate.promise;
        });
        const first = slot.load('a');
        slot.abort();
        gate.reject(new Error('obsolete'));
        await first;
        expect(slot.getData()).toMatchObject({status: S.Success, data: 'replacement', error: undefined});
        expect(slot.snapshot().key).toBe(JSON.stringify('b'));
        expect(slot.getLastError()).toBeUndefined();
    });
    test.each([0, false, '', undefined])('raw falsy rejection %s retains explicit presence', async (raw) => {
        const cache = new ResourceCache<string, string>(() => Promise.reject(raw));
        const slot = new ResourceCarburetor<string, string>(() => Promise.reject(raw));
        await Promise.all([cache.load('a'), slot.load('a')]);
        expect(cache.getEntry('a')).toMatchObject({status: S.Error, error: String(raw), failed: true});
        expect(slot.getData()).toMatchObject({status: S.Error, error: String(raw)});
        expect(cache.getFailure('a')).toBe(raw);
        expect(slot.getLastError()).toBe(raw);
        let cacheThrew = false;
        let slotThrew = false;
        try { cache.suspend('a'); } catch (error) { cacheThrew = true; expect(error).toBe(raw); }
        try { slot.suspend('a'); } catch (error) { slotThrew = true; expect(error).toBe(raw); }
        expect(cacheThrew).toBe(true);
        expect(slotThrew).toBe(true);
    });

    test('ordinary failed refresh retains good data and captured view', async () => {
        const raw = new Error('offline');
        const cache = new ResourceCache<string, string>(() => Promise.reject(raw), {ttl: Infinity});
        const key = cache.resolve('a').key;
        cache.setData({entries: {[key]: ready('good')}});
        const captured = cache.resolve('a');
        await cache.refresh('a');
        expect(cache.getEntry('a')).toMatchObject({status: S.Success, data: 'good', error: 'offline', failed: true});
        expect(cache.getFailure('a')).toBe(raw);
        expect(captured.view).toMatchObject({data: 'good', error: undefined, failed: false});
    });

    test.each(['root', 'entry'] as const)('abort listener %s replacement survives late failure and next load',
        async (shape) => {
        const gates = [deferred<string>(), deferred<string>()];
        let calls = 0;
        class EditableCache extends ResourceCache<string, string> {
            /** Replace one entry through the supported subclass action boundary.
             *
             * @param key - encoded entry key.
             */
            public replaceEntry(key: string): void {
                this.update(draft => { draft.entries[key] = ready('replacement'); });
            }
        }
        const cache = new EditableCache((_args, signal) => {
            const gate = gates[calls++];
            if (calls === 1) signal.addEventListener('abort', () => {
                const key = cache.resolve('a').key;
                if (shape === 'root') cache.setData({entries: {[key]: ready('replacement')}});
                else cache.replaceEntry(key);
            }, {once: true});
            return gate.promise;
        }, {ttl: Infinity});
        const first = cache.load('a');
        cache.abort('a');
        gates[0].reject(new Error('obsolete'));
        await first;
        expect(cache.getEntry('a')).toMatchObject({status: S.Success, data: 'replacement',
            error: undefined, failed: false});
        expect(cache.getFailure('a')).toBeUndefined();
        const second = cache.refresh('a');
        expect(calls).toBe(2);
        gates[1].resolve('current');
        await second;
        expect(cache.getEntry('a').data).toBe('current');
    });
});

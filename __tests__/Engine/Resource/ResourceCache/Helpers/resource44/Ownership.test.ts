import {EResourceStatus as S, ResourceCache, ResourceCarburetor} from '@/Carburetor';
import {deferred} from '../../../Resource/helpers';

const ready = (data: string) => ({status: S.Success, data, error: undefined,
    updatedAt: Date.now(), refreshing: false, invalidated: false, failed: false});
const rejection = (style: string, describe: () => string): unknown => style === 'object'
    ? {toString: describe} : Object.defineProperty(new Error('unused'), 'message', {get: describe});

for (const style of ['object', 'getter']) {
    describe(`resource44 ownership: ${style}`, () => {
        test.each(['ready', 'empty'] as const)('cache restore %s detaches failure ownership', async (shape) => {
            const gate = deferred<string>();
            const cache = new ResourceCache<string, string>(() => gate.promise, {ttl: Infinity});
            const first = cache.load('a');
            const captured = cache.resolve('a');
            const raw = rejection(style, () => {
                cache.restore({entries: shape === 'ready' ? {[captured.key]: ready('restored')} : {}});
                return 'obsolete';
            });
            gate.reject(raw);
            await first;
            expect(cache.resolve('a').present).toBe(shape === 'ready');
            expect(cache.getEntry('a')).toMatchObject({status: shape === 'ready' ? S.Success : S.Idle,
                data: shape === 'ready' ? 'restored' : undefined, error: undefined, failed: false});
            expect(cache.getFailure('a')).toBeUndefined();
            expect(captured.view).toMatchObject({status: S.Pending, error: undefined});
        });

        test.each(['ready', 'empty'] as const)('slot restore %s wins over described failure', async (shape) => {
            const gate = deferred<string>();
            const slot = new ResourceCarburetor<string, string>(() => gate.promise);
            const first = slot.load('a');
            gate.reject(rejection(style, () => {
                slot.restore(shape === 'ready' ? {...ready('restored'), key: JSON.stringify('a')}
                    : {status: S.Idle, data: undefined, error: undefined, updatedAt: undefined});
                return 'obsolete';
            }));
            await first;
            expect(slot.getData()).toMatchObject({status: shape === 'ready' ? S.Success : S.Idle,
                data: shape === 'ready' ? 'restored' : undefined, error: undefined});
            expect(slot.getLastError()).toBeUndefined();
            expect(slot.snapshot().key).toBe(shape === 'ready' ? JSON.stringify('a') : undefined);
        });

        test.each(['refresh', 'forget-load'] as const)('cache %s starts a genuine second loader', async (action) => {
            const gates = [deferred<string>(), deferred<string>()];
            let calls = 0;
            const cache = new ResourceCache<string, string>(() => gates[calls++].promise, {ttl: Infinity});
            const first = cache.load('a');
            let second: Promise<void> | undefined;
            const states: string[] = [];
            const id = cache.subscribe(() => states.push(cache.getEntry('a').status));
            try {
                gates[0].reject(rejection(style, () => {
                    if (action === 'forget-load') cache.forget('a');
                    second = action === 'refresh' ? cache.refresh('a') : cache.load('a');
                    return 'obsolete';
                }));
                await first;
                expect(calls).toBe(2);
                expect(second).not.toBe(first);
                expect(cache.load('a')).toBe(second);
                expect(cache.getEntry('a')).toMatchObject({status: S.Pending, error: undefined, failed: false});
                expect(states).not.toContain(S.Error);
                gates[1].resolve('current');
                await second;
                expect(cache.getEntry('a')).toMatchObject({status: S.Success, data: 'current', error: undefined});
                expect(cache.getFailure('a')).toBeUndefined();
            } finally { cache.unsubscribe(id); }
        });

        test('a replacement cancelled inside description still supersedes the old generation', async () => {
            const gates = [deferred<string>(), deferred<string>()];
            let calls = 0;
            const cache = new ResourceCache<string, string>(() => gates[calls++].promise);
            const first = cache.load('a');
            let second: Promise<void> | undefined;
            gates[0].reject(rejection(style, () => {
                second = cache.refresh('a');
                cache.abort('a');
                return 'obsolete';
            }));
            await first;
            expect(calls).toBe(2);
            expect(cache.getEntry('a')).toMatchObject({status: S.Idle, error: undefined, failed: false});
            expect(cache.getFailure('a')).toBeUndefined();
            gates[1].resolve('cancelled');
            await second;
            expect(cache.getEntry('a')).toMatchObject({status: S.Idle, data: undefined, error: undefined});
        });

        test('slot new-key loader survives old failure conversion', async () => {
            const gates = [deferred<string>(), deferred<string>()];
            const keys: string[] = [];
            const slot = new ResourceCarburetor<string, string>((key) => {
                keys.push(key);
                return gates[keys.length - 1].promise;
            });
            const first = slot.load('a');
            let second: Promise<void> | undefined;
            gates[0].reject(rejection(style, () => { second = slot.load('b'); return 'obsolete'; }));
            await first;
            expect(keys).toEqual(['a', 'b']);
            expect(slot.load('b')).toBe(second);
            expect(slot.getData()).toMatchObject({status: S.Pending, error: undefined});
            gates[1].resolve('current');
            await second;
            expect(slot.getData()).toMatchObject({status: S.Success, data: 'current', error: undefined});
            expect(slot.snapshot().key).toBe(JSON.stringify('b'));
            expect(slot.getLastError()).toBeUndefined();
        });
    });
}

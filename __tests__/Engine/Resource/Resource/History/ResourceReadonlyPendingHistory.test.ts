import {CarburetorHistory, EResourceStatus, IResourceData, ResourceCarburetor} from '@/Carburetor';

describe('readonly pending resource history', () => {
    test.each([true, false])('normalizes before installing status, configurable=%s', configurable => {
        const resource = new ResourceCarburetor<object>(async () => ({}));
        const history = new CarburetorHistory(resource);
        const key = {id: 1};
        const map = new Map<object, unknown>();
        const set = new Set<object>();
        const date = new Date(7);
        const data = {key, alias: key, map, set, date};
        const pending: IResourceData<typeof data> = {
            status: EResourceStatus.Pending, data, error: undefined, updatedAt: 7,
        };
        map.set(key, pending);
        map.set(pending, data);
        set.add(pending);
        set.add(key);
        Object.defineProperty(date, 'owner', {
            value: pending, enumerable: true, writable: false, configurable: false,
        });
        Object.defineProperty(pending, 'status', {
            value: EResourceStatus.Pending, enumerable: true, writable: false, configurable,
        });

        resource.setData(pending);
        expect(history.undo()).toBe(true);
        expect(history.redo()).toBe(true);
        const restored = resource.getData();
        const payload = restored.data!;
        expect(restored.status).toBe(EResourceStatus.Idle);
        expect(restored.updatedAt).toBe(7);
        expect(Object.getOwnPropertyDescriptor(restored, 'status')).toMatchObject({
            value: EResourceStatus.Idle, writable: false, enumerable: true, configurable,
        });
        expect(Object.keys(restored)).toEqual(['status', 'data', 'error', 'updatedAt']);
        expect(resource.snapshot().key).toBeUndefined();
        expect(payload.alias).toBe(payload.key);
        expect(payload.map.get(payload.key)).toBe(restored);
        expect(payload.map.get(restored)).toBe(payload);
        expect(payload.set.has(restored)).toBe(true);
        expect(payload.set.has(payload.key)).toBe(true);
        expect((payload.date as Date & {owner: object}).owner).toBe(restored);
        expect(Object.getOwnPropertyDescriptor(payload.date, 'owner')?.writable).toBe(false);
        expect(restored).not.toBe(pending);
        expect(pending.status).toBe(EResourceStatus.Pending);
        expect(map.get(key)).toBe(pending);
        expect(history.canUndo()).toBe(true);
        expect(history.canRedo()).toBe(false);
        expect(history.undo()).toBe(true);
        expect(history.redo()).toBe(true);
        expect(resource.getData().status).toBe(EResourceStatus.Idle);
        history.disconnect();
    });

    test('independent histories retain their cursors across clear and readonly redo', () => {
        const resource = new ResourceCarburetor<number>(async () => 1);
        const first = new CarburetorHistory(resource);
        const second = new CarburetorHistory(resource);
        const pending = {status: EResourceStatus.Pending, data: 3, error: undefined, updatedAt: 7};
        Object.defineProperty(pending, 'status', {
            value: EResourceStatus.Pending, enumerable: true, writable: false, configurable: false,
        });
        resource.setData(pending);
        first.clear();
        expect(first.canUndo()).toBe(false);
        expect(first.canRedo()).toBe(false);
        expect(second.undo()).toBe(true);
        expect(second.redo()).toBe(true);
        expect(resource.getData().status).toBe(EResourceStatus.Idle);
        expect(resource.getData().updatedAt).toBe(7);
        expect(second.canUndo()).toBe(true);
        expect(second.canRedo()).toBe(false);
        first.clear();
        expect(first.canUndo()).toBe(false);
        expect(second.undo()).toBe(true);
        expect(second.redo()).toBe(true);
        expect(resource.getData().status).toBe(EResourceStatus.Idle);
        first.disconnect();
        second.disconnect();
    });

    test('undoing into readonly pending cancels an in-flight request and drops its late answer', async () => {
        let finish!: (value: number) => void;
        const resource = new ResourceCarburetor<number, string>(() => new Promise<number>(resolve => {
            finish = resolve;
        }));
        const history = new CarburetorHistory(resource);
        const pending = {status: EResourceStatus.Pending, data: 3, error: 'old', updatedAt: 7};
        Object.defineProperty(pending, 'status', {
            value: EResourceStatus.Pending, enumerable: true, writable: false, configurable: false,
        });
        resource.setData(pending);
        const request = resource.load('slow');
        expect(resource.getData().status).toBe(EResourceStatus.Pending);
        expect(history.undo()).toBe(true);
        expect(resource.getData().status).toBe(EResourceStatus.Idle);
        expect(resource.getData().updatedAt).toBe(7);
        expect(Object.getOwnPropertyDescriptor(resource.getData(), 'status')?.writable).toBe(false);
        finish(99);
        await request;
        expect(resource.getData().status).toBe(EResourceStatus.Idle);
        expect(resource.getData().data).toBe(3);
        expect(resource.getData().error).toBe('old');
        expect(resource.snapshot().key).toBeUndefined();
        expect(history.redo()).toBe(true);
        expect(resource.getData().status).toBe(EResourceStatus.Idle);
        history.disconnect();
    });

    test('a synchronous abort listener supersedes readonly pending replay and owns its key', async () => {
        let finish!: (value: number) => void;
        let resource!: ResourceCarburetor<number, string>;
        resource = new ResourceCarburetor<number, string>((_key, signal) => {
            signal.addEventListener('abort', () => resource.restore({
                status: EResourceStatus.Success, data: 44, error: undefined,
                updatedAt: 12, key: JSON.stringify('new'),
            }));
            return new Promise<number>(resolve => { finish = resolve; });
        });
        const history = new CarburetorHistory(resource);
        const pending = {status: EResourceStatus.Pending, data: 3, error: 'old', updatedAt: 7};
        Object.defineProperty(pending, 'status', {
            value: EResourceStatus.Pending, enumerable: true, writable: false, configurable: false,
        });
        resource.setData(pending);
        const request = resource.load('slow');
        expect(history.undo()).toBe(true);
        expect(resource.getData().status).toBe(EResourceStatus.Success);
        expect(resource.getData().data).toBe(44);
        expect(resource.snapshot().key).toBe(JSON.stringify('new'));
        expect(history.canRedo()).toBe(false);
        finish(99);
        await request;
        expect(resource.getData().data).toBe(44);
        history.disconnect();
    });
});

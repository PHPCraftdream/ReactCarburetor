import {CarburetorHistory, EResourceStatus, ResourceCarburetor} from '@/Carburetor';

describe('owned history replay with a locked status flag', () => {
    test('undo/redo replays without assigning an equal readonly flag', () => {
        const resource = new ResourceCarburetor<string, string>(async key => `answer-${key}`);
        const history = new CarburetorHistory(resource);
        const base = {...resource.getData(), updatedAt: 7} as Record<string, unknown>;
        Object.defineProperty(base, 'isIdle', {
            value: true, writable: false, configurable: false, enumerable: true,
        });
        resource.setData(base as never);
        resource.setData({...resource.getData(), data: 'draft', updatedAt: 8} as never);

        expect(() => history.undo()).not.toThrow();
        const restored = resource.getData() as Record<string, unknown>;
        expect(restored.updatedAt).toBe(7);
        expect(restored.status).toBe(EResourceStatus.Idle);
        expect(restored.isIdle).toBe(true);
        expect(Object.getOwnPropertyDescriptor(restored, 'isIdle')?.writable).toBe(false);
        history.disconnect();
    });

    test('a locked flag holding a wrong value is corrected in a copy', () => {
        const resource = new ResourceCarburetor<string, string>(async key => `answer-${key}`);
        const history = new CarburetorHistory(resource);
        const base = {...resource.getData(), updatedAt: 7} as Record<string, unknown>;
        Object.defineProperty(base, 'isError', {
            value: true, writable: false, configurable: false, enumerable: true,
        });
        resource.setData(base as never);
        resource.setData({...resource.getData(), data: 'draft', updatedAt: 8} as never);

        expect(() => history.undo()).not.toThrow();
        const restored = resource.getData() as Record<string, unknown>;
        expect(restored.updatedAt).toBe(7);
        expect([restored.isIdle, restored.isPending, restored.isSuccess, restored.isError])
            .toEqual([true, false, false, false]);
        history.disconnect();
    });
});

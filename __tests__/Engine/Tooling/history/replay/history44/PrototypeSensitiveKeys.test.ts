import {Carburetor, CarburetorHistory} from '@/Carburetor';

class PrototypeKeyStore extends Carburetor<{slot: Record<string, unknown> | null}> {
    public insert(key: string): void {
        this.update(draft => {
            draft.slot = {};
            draft.slot[key] = {x: 1};
        });
    }
}

describe('history44 prototype-sensitive keys', () => {
    test.each(['__proto__', 'constructor', 'toString'])('%s remains an own key through replay', key => {
        const store = new PrototypeKeyStore({slot: null});
        const history = new CarburetorHistory(store);
        const normalPrototype = Object.prototype;
        try {
            store.insert(key);
            const inserted = store.getData().slot;
            expect(inserted).not.toBeNull();
            expect(Object.getPrototypeOf(inserted)).toBe(normalPrototype);
            expect(Object.prototype.hasOwnProperty.call(inserted, key)).toBe(true);
            expect(inserted?.[key]).toEqual({x: 1});
            const snapshot = store.snapshot();
            const insertedSnapshot = snapshot.slot;
            expect(Object.getPrototypeOf(insertedSnapshot)).toBe(normalPrototype);
            expect(Object.prototype.hasOwnProperty.call(insertedSnapshot, key)).toBe(true);

            expect(history.undo()).toBe(true);
            expect(store.getData().slot).toBeNull();
            expect(history.redo()).toBe(true);

            const redone = store.getData().slot;
            expect(Object.getPrototypeOf(redone)).toBe(normalPrototype);
            expect(Object.prototype.hasOwnProperty.call(redone, key)).toBe(true);
            expect(redone?.[key]).toEqual({x: 1});
            const redoneSnapshot = store.snapshot().slot;
            expect(Object.getPrototypeOf(redoneSnapshot)).toBe(normalPrototype);
            expect(Object.prototype.hasOwnProperty.call(redoneSnapshot, key)).toBe(true);
            expect(store.snapshot()).toEqual(snapshot);
        } finally { history.disconnect(); }
    });
});

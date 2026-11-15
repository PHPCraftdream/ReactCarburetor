import {Carburetor} from "@/Carburetor";

interface IData {value: number;}

class Plain extends Carburetor<IData> {
    public change(mutate: (draft: IData) => void): void { this.update(mutate); }
}

class FailingPreEmit extends Plain {
    protected preEmit(): void { throw new Error('preEmit failed'); }
}

describe('emitStoreUpdate', () => {
    test('a draft write notifies its subscriber once', () => {
        const store = new Plain({value: 0});
        let calls = 0;
        store.subscribe(() => { calls++; }, {id: 'updates'});
        store.change(draft => { draft.value = 1; });
        expect(store.getData().value).toBe(1);
        expect(calls).toBe(1);
    });

    test('a failing preEmit still publishes the write and reaches the caller', () => {
        const store = new FailingPreEmit({value: 0});
        let calls = 0;
        store.subscribe(() => { calls++; });
        expect(() => store.change(draft => { draft.value = 1; })).toThrow('preEmit failed');
        expect(store.getData().value).toBe(1);
        expect(store.getVersion()).toBe(1);
        expect(calls).toBe(1);
    });
});

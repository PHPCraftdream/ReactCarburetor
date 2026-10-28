import {Carburetor} from "@/Carburetor";

describe('emitStoreUpdate', () => {
    test('notifies on draft writes and preserves the first observer delivery failure', () => {
        const store = new Carburetor({value: 0});
        let calls = 0;
        store.subscribe(() => { calls++; }, {id: 'updates'});
        store.update(draft => { draft.value = 1; });
        expect(store.getData().value).toBe(1);
        expect(calls).toBe(1);
    });
});

import {Carburetor} from "@/Carburetor";

describe('installState', () => {
    test('installs a replacement and publishes its changed root', () => {
        const store = new Carburetor({value: 1});
        let observed: number | undefined;
        store.subscribe(() => { observed = store.getData().value; }, {id: 'replacement'});
        const root = {value: 2};
        expect(store.setData(root)).toBe(root);
        expect(store.getData()).toBe(root);
        expect(observed).toBe(2);
    });
});

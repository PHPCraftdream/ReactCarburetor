import {containsExoticValue} from '@/Carburetor/Store/Utils/Graph/containsExoticValue';

describe('containsExoticValue graph reflection gaps', () => {
    test('a disappearing own key descriptor is skipped', () => {
        const target = {member: 1};
        const proxy = new Proxy(target, {
            ownKeys: () => ['member'],
            getOwnPropertyDescriptor: () => undefined,
        });

        expect(containsExoticValue(proxy)).toBe(false);
    });

    test('a proxy rejecting own-key reflection is conservatively exotic', () => {
        const proxy = new Proxy({}, {
            ownKeys: () => { throw new Error('reflection denied'); },
        });

        expect(containsExoticValue(proxy)).toBe(true);
    });
});

import {IDict} from '@/Carburetor';
import {getUid} from '@/Carburetor/Store/Utils/getUid';
import {isString} from "./isString";

// The key sharedSingleton.ts builds for the uid counter; a test can read the shared slot
// directly without the module exposing that as part of its actual API.
const UID_COUNTER_KEY = Symbol.for('react-carburetor/v1/uidCounter');

describe('getUid', () => {
    test('1000 iterations', () => {
        let found: IDict<boolean> = {};

        for (let i = 0; i < 1000; i++) {
            const newValue = getUid();

            expect(isString(newValue)).toBeTruthy();

            expect(newValue in found).toBeFalsy();

            found[newValue] = true;

            expect(newValue in found).toBeTruthy();
        }
    });

    test('the counter lives in the shared globalThis slot, not a module-local variable', () => {
        const before = getUid();
        const beforeNumber = Number(before.replace('carburetor-uid-', ''));

        const slot = (globalThis as Record<symbol, {value: {next: number}} | undefined>)[UID_COUNTER_KEY];

        expect(slot).toBeDefined();
        expect(slot!.value.next).toEqual(beforeNumber);

        const after = getUid();
        const afterNumber = Number(after.replace('carburetor-uid-', ''));

        expect(afterNumber).toEqual(beforeNumber + 1);
        expect(slot!.value.next).toEqual(afterNumber);
    });
});

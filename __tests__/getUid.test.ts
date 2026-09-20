import {getUid, IDict} from '../lib/src/Carburetor';
import {isString} from "./utils";

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
});

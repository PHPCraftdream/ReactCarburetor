import {createTestScope} from '@/Testing';
import {carburetorToken} from '@/Carburetor';

describe('createTestScope', () => {
    test('disposes owned instances', () => {
        let disposed = 0;
        const token = carburetorToken(
            () => ({dispose: () => { disposed++; }}),
            'other-gaps/create-test-scope-disposal',
        );
        const scope = createTestScope();
        scope.get(token);
        expect(disposed).toBe(0);
        scope[Symbol.dispose]();
        expect(disposed).toBe(1);
    });
});

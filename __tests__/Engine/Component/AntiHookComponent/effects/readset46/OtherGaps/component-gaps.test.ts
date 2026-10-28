import {AttemptEntry} from '@/Carburetor/Component/Models/AttemptEntry';
import {Carburetor, CarburetorScope, carburetorToken} from '@/Carburetor';
import {TPath} from '@/Carburetor/Models/Paths';

const path = (value: string): TPath => value as TPath;

describe('AttemptEntry component read-set gaps', () => {
    test('AttemptEntry keeps an adopted read set intact when recording an existing path', () => {
        const source = new Carburetor({value: 0});
        const committed = new Set<TPath>([path('value')]);
        const entry = new AttemptEntry(source, 0);
        entry.reads = committed;
        entry.sharedReads = true;

        entry.record(path('value'));

        expect(entry.reads).toBe(committed);
        expect(committed).toEqual(new Set([path('value')]));
        expect(entry.sharedReads).toBe(true);
    });

    test('AttemptEntry copies adopted reads before adding a new path', () => {
        const source = new Carburetor({value: 0});
        const committed = new Set<TPath>([path('value')]);
        const entry = new AttemptEntry(source, 0);
        entry.reads = committed;
        entry.sharedReads = true;

        entry.record(path('other'));

        expect(entry.reads).not.toBe(committed);
        expect(entry.reads).toEqual(new Set([path('value'), path('other')]));
        expect(committed).toEqual(new Set([path('value')]));
        expect(entry.sharedReads).toBe(false);
    });

});

describe('CarburetorScope hydration gaps', () => {
    test('hydration ignores a token whose instance is not an object', () => {
        const token = carburetorToken(() => 7, 'other-gaps/non-object');
        const scope = new CarburetorScope();

        scope.hydrate({[token.id]: {value: 9}}, [token]);

        expect(scope.get(token)).toBe(7);
    });
});

import * as Interop from '@/Interop';
import type {IResourceSource, IResourceView} from '@/Carburetor/Models/Resource';

const assertGenericTypes = <T, TArgs>(source: IResourceSource<T, TArgs>, args: TArgs): void => {
    const inferred = Interop.useResourceValue(source, args);
    const view: IResourceView<T> = inferred;
    const data: T | undefined = inferred.data;

    void view;
    void data;
};

const assertConcreteTypes = (source: IResourceSource<{name: string}, {id: number}>): void => {
    const inferred = Interop.useResourceValue(source, {id: 1});
    const view: IResourceView<{name: string}> = inferred;
    const name: string | undefined = inferred.data?.name;

    // @ts-expect-error wrong argument type
    Interop.useResourceValue<{name: string}, {id: number}>(source, {id: 'wrong'});
    // @ts-expect-error Resource data must preserve the source result type.
    const wrongResult: IResourceView<{name: number}> = inferred;

    void wrongResult;
    void view;
    void name;
};

// Compile-time consumers only: hooks must not be called outside a React render.
void assertGenericTypes;
void assertConcreteTypes;

describe('R40 Interop public surface', () => {
    test('exports exactly the three value hooks', () => {
        expect(Object.keys(Interop).sort()).toEqual([
            'useCarburetorValue',
            'useComputedValue',
            'useResourceValue',
        ]);
    });
});

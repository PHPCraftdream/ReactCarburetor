import * as Interop from '@/Interop';
import type {TReadonly, IResourceSource, IResourceView} from '@/Carburetor';

const assertGenericTypes = <T, TArgs>(source: IResourceSource<T, TArgs>, args: TArgs): void => {
    const inferred = Interop.useResourceValue(source, args, view => view);
    // Identity selects the already-readonly input as R; the hook applies TReadonly<R> again.
    const view: TReadonly<TReadonly<IResourceView<T>>> = inferred;
    const data: TReadonly<TReadonly<IResourceView<T>>>['data'] = inferred.data;

    void view;
    void data;
};

const assertConcreteTypes = (source: IResourceSource<{name: string}, {id: number}>): void => {
    const inferred = Interop.useResourceValue(source, {id: 1}, view => view);
    const view: TReadonly<IResourceView<{name: string}>> = inferred;
    const name: string | undefined = inferred.data?.name;

    // @ts-expect-error wrong argument type
    Interop.useResourceValue(source, {id: 'wrong'}, view => view);
    // @ts-expect-error selector is mandatory
    Interop.useResourceValue(source, {id: 1});
    // @ts-expect-error selected fields are readonly
    inferred.data!.name = 'mutated';
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

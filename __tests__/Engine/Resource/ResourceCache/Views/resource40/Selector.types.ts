import {useResourceValue} from '@/Interop';
import type {IResourceSource, TReadonly} from '@/Carburetor';

interface IData {
    nested: {label: string};
}

interface IArgs {
    id: number;
}

declare const source: IResourceSource<IData, IArgs>;
declare const args: IArgs;
declare const thenable: PromiseLike<string>;

const assertSelectorTypes = (): void => {
    const scalar = useResourceValue(source, args, view => view.data?.nested.label);
    const scalarType: TReadonly<string | undefined> = scalar;

    const object = useResourceValue(source, args, view => ({nested: view.data?.nested}));
    const objectType: TReadonly<{nested: {label: string} | undefined}> = object;

    const array = useResourceValue(source, args, view => [view.status, view.data?.nested.label]);
    const arrayType: TReadonly<Array<string | undefined>> = array;

    const undefinedValue = useResourceValue(source, args, () => undefined);
    const undefinedType: undefined = undefinedValue;
    const nullValue = useResourceValue(source, args, () => null);
    const nullType: null = nullValue;
    const union = useResourceValue(source, args, view => view.data ? view.data.nested.label : null);
    const unionType: TReadonly<string | null> = union;

    // @ts-expect-error async selector results are not supported
    useResourceValue(source, args, async view => view.data?.nested.label);
    // @ts-expect-error PromiseLike selector results are not supported
    useResourceValue(source, args, () => thenable);
    // @ts-expect-error unions containing PromiseLike are not supported
    useResourceValue(source, args, view => Math.random() ? view.data?.nested.label : Promise.resolve('later'));

    // @ts-expect-error the returned object and its nested data are readonly
    object.nested!.label = 'changed';
    // @ts-expect-error selected arrays are readonly
    array.push('changed');

    void [scalarType, objectType, arrayType, undefinedType, nullType, unionType];
};

void assertSelectorTypes;

import {Carburetor, IComputedOptions, TComputeBody, TComputedReader, computed} from '@react-carburetor/core';

interface State {count: number}
const store = new Carburetor<State>({count: 2});
const body: TComputeBody<number> = read => read(store).count;
const computedOptions: IComputedOptions<number> = {equals: Object.is};
const typedReader: TComputedReader = (source: any) => source;
const doubled = computed(body, computedOptions);
const value: number = doubled.get();
void [value, typedReader];

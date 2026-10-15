import {TSelector, TValueComparator, useCarburetorValue, useComputedValue, useResourceValue} from 'react-carburetor/interop';
import {Carburetor} from 'react-carburetor';

interface Model {count: number}
const selectCount: TSelector<Model, number> = data => data.count;
const sameCount: TValueComparator<number> = (left, right) => left === right;
const store = new Carburetor<Model>({count: 4});
const count: number = useCarburetorValue(store, selectCount, sameCount);
const derived = {
    get: () => count,
    getUID: () => 'computed',
    getVersion: () => 0,
    subscribe: () => 'id',
    unsubscribe: () => undefined,
};
const derivedValue: number = useComputedValue(derived);
void [count, derivedValue, useResourceValue];

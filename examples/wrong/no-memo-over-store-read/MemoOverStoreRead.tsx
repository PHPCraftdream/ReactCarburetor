import {useMemo} from 'react';
import {useCarburetorValue} from '@react-carburetor/core/interop';
import {Carburetor} from '@react-carburetor/core';

type TState = {count: number};
const selectCount = (value: TState): number => value.count;

export function MemoOverStoreRead({store}: {store: Carburetor<TState>}) {
    const count = useCarburetorValue(store, selectCount);
    const doubled = useMemo(() => count * 2, [count]);
    return <span>{doubled}</span>;
}

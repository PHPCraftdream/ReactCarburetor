import {useCarburetorValue} from '@react-carburetor/core/interop';
import {Carburetor} from '@react-carburetor/core';

export function CapturingHookSelector({offset, store}: {offset: number; store: Carburetor<{count: number}>}) {
    const count = useCarburetorValue(store, value => value.count + offset);
    return <span>{count}</span>;
}

import {useCarburetorValue} from 'react-carburetor/interop';
import {Carburetor} from 'react-carburetor';

export function CapturingHookSelector({offset, store}: {offset: number; store: Carburetor<{count: number}>}) {
    const count = useCarburetorValue(store, value => value.count + offset);
    return <span>{count}</span>;
}

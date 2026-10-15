// #region count
import type {ReactElement} from 'react';
import {Carburetor} from 'react-carburetor';
import {useCarburetorValue} from 'react-carburetor/interop';

class CounterCarburetor extends Carburetor<{count: number}> {
    public constructor() {
        super({count: 0});
    }
}

const counter = new CounterCarburetor();

const selectCount = (counter: {count: number}): number => counter.count;

function Count(): ReactElement {
    const count = useCarburetorValue(counter, selectCount, Object.is);
    return <span>{count}</span>;
}
// #endregion count
void Count;

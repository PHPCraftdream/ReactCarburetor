// #region view
import {memo, type ReactElement} from 'react';
import {Carburetor, Computed} from 'react-carburetor';
import {useComputedValue, useCarburetorValue} from 'react-carburetor/interop';

class CounterCarburetor extends Carburetor<{count: number}> {
    public constructor() {
        super({count: 0});
    }
}

const counter = new CounterCarburetor();
const doubled = new Computed((read) => read(counter).count * 2);

const DoubledLabel = memo(function DoubledLabel({value}: {value: number}): ReactElement {
    return <span>{value}</span>;
});

const selectCounterCount = (c: {count: number}): number => c.count;

function CounterView(): ReactElement {
    const count = useCarburetorValue(counter, selectCounterCount);
    const value = useComputedValue(doubled);
    return (
        <div>
            <span>{count}</span>
            <DoubledLabel value={value} />
        </div>
    );
}
// #endregion view
void CounterView;

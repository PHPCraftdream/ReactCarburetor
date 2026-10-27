// #region doc
import {bind, Carburetor} from '@react-carburetor/core';
import {useCarburetorValue} from '@react-carburetor/core/interop';

const incrementValue = (draft: {value: number}): void => { draft.value += 1; };
const selectValue = (state: {value: number}): number => state.value;

class CounterCarburetor extends Carburetor<{value: number}> {
    @bind
    inc(): void {
        this.update(incrementValue);
    }
}

const counterCarburetor = new CounterCarburetor({value: 0});
const incrementCounter = (): void => { counterCarburetor.inc(); };

function Counter() {
    const value = useCarburetorValue(counterCarburetor, selectValue);

    return <button onClick={incrementCounter}>{value}</button>;
}
// #endregion doc
void Counter;

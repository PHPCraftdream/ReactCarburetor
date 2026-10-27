// #region doc
import {Carburetor} from '@react-carburetor/core';

interface CounterState { count: number; name: string }

class Counter extends Carburetor<CounterState> {
    public bump(step: number): void {
        this.update((draft) => {
            draft.count += step;
        });
    }
}
// #endregion doc

void Counter;

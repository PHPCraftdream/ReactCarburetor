// #region doc
import {bind, Carburetor} from 'react-carburetor';

const incrementValue = (draft: {value: number}): void => { draft.value += 1; };

class CounterCarburetor extends Carburetor<{value: number}> {
    @bind
    inc(): void {
        this.update(incrementValue);
    }
}

const counterCarburetor = new CounterCarburetor({value: 0});
// #endregion doc
void counterCarburetor;

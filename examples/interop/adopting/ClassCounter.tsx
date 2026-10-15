// #region doc
import {AntiHookComponent, bind, Carburetor} from 'react-carburetor';

const incrementValue = (draft: {value: number}): void => { draft.value += 1; };

class CounterCarburetor extends Carburetor<{value: number}> {
    @bind
    inc(): void {
        this.update(incrementValue);
    }
}

const counterCarburetor = new CounterCarburetor({value: 0});

export class Counter extends AntiHookComponent {
    render() {
        const {value} = this.useCarburetor(counterCarburetor);

        return <button onClick={counterCarburetor.inc}>{value}</button>;
    }
}
// #endregion doc

import {AntiHookComponent, Carburetor, bind} from 'react-carburetor';

const incrementBy = (draft: {value: number}, step: number): void => {
    draft.value += step;
};

class CounterCarburetor extends Carburetor<{value: number}> {
    @bind
    inc(): void {
        this.update(incrementBy, 1);
    }
}

const counterCarburetor = new CounterCarburetor({value: 0});

export class Counter extends AntiHookComponent {
    public render() {
        const {value} = this.useCarburetor(counterCarburetor);

        return <button onClick={counterCarburetor.inc}>{value}</button>;
    }
}

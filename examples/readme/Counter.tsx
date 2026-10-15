import {AntiHookComponent, Carburetor, bind} from 'react-carburetor';

class CounterCarburetor extends Carburetor<{value: number}> {
    @bind
    inc(): void {
        this.draft.value += 1;
        this.emitUpdate();
    }
}

const counterCarburetor = new CounterCarburetor({value: 0});

export class Counter extends AntiHookComponent {
    public render() {
        const {value} = this.useCarburetor(counterCarburetor);

        return <button onClick={counterCarburetor.inc}>{value}</button>;
    }
}

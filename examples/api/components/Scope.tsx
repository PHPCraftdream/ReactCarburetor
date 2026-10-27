// #region doc
import {
    bind,
    carburetorToken,
    Carburetor,
    CarburetorScope,
    ICarburetorToken,
    ScopedAntiHookComponent,
} from '@react-carburetor/core';

interface ICounterData {
    count: number;
}

class CounterCarburetor extends Carburetor<ICounterData> {
    public increment(): void {
        this.setData({count: this.getData().count + 1});
    }
}

const counterToken: ICarburetorToken<CounterCarburetor> = carburetorToken(
    () => new CounterCarburetor({count: 0}),
    'examples-counter',
);

class ScopedCounter extends ScopedAntiHookComponent {
    @bind
    protected onClick(): void {
        this.resolve(counterToken).increment();
    }

    public render() {
        const counter = this.useCarburetor(this.resolve(counterToken));
        return <button onClick={this.onClick}>{counter.count}</button>;
    }
}

const scope = new CarburetorScope();
const counter = scope.get(counterToken);
// #endregion doc

void ScopedCounter;
void counter;

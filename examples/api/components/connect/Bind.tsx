// #region doc
import {AntiHookComponent, bind, Carburetor} from '@react-carburetor/core';

interface ICounterData {
    count: number;
}

class CounterCarburetor extends Carburetor<ICounterData> {
    public increment(): void {
        this.setData({count: this.getData().count + 1});
    }
}

const counter = new CounterCarburetor({count: 0});

class CounterButton extends AntiHookComponent {
    private readonly data = this.connect(counter);

    @bind
    protected onClick(): void {
        counter.increment();
    }

    public render() {
        return <button onClick={this.onClick}>{this.data.count}</button>;
    }
}
// #endregion doc

void CounterButton;

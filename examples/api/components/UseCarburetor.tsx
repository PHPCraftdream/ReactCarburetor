// #region doc
import {AntiHookComponent, Carburetor} from 'react-carburetor';

interface ICounterData {
    count: number;
}

class CounterCarburetor extends Carburetor<ICounterData> {
    public increment(): void {
        this.setData({count: this.getData().count + 1});
    }
}

const counter = new CounterCarburetor({count: 0});

interface ICounterProps {
    carburetor: CounterCarburetor;
}

class CounterView extends AntiHookComponent<ICounterProps> {
    public render() {
        const data = this.useCarburetor(this.props.carburetor);
        return <span>{data.count}</span>;
    }
}
// #endregion doc

void CounterView;
void counter;

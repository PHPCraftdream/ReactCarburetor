import {
    Carburetor, ICarburetor, IReadableCarburetor, ISubscribeOptions, TDisposer, TReadonly, TSelector, transaction,
} from 'react-carburetor';

interface State {value: number}
const store = new Carburetor<State>({value: 1});
const readable: IReadableCarburetor<State> = store;
const options: ISubscribeOptions = {id: 'counter'};
const selector: TSelector<State, number> = state => state.value;
const selected: TReadonly<number> = store.getData().value;
const changed: TDisposer = store.watch(selector, () => undefined);
const full: ICarburetor<State> = store;
transaction(() => store.setData({value: store.getData().value + 1}));
void [readable, options, selected, changed, full];

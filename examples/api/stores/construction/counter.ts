// #region creating-store
import {Carburetor, ICarburetor} from 'react-carburetor';

const increment = (draft: {value: number}): void => { draft.value += 1; };

class CounterStore extends Carburetor<{value: number}> {
    public increment(): void { this.update(increment); }
}

const counterStore = new CounterStore({value: 0});
const counter: ICarburetor<{value: number}> = counterStore; // the full contract, kept narrow for consumers
counterStore.increment();
// #endregion creating-store
void counter;

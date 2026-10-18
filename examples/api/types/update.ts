// #region doc
import {Carburetor} from 'react-carburetor';

interface CounterState { count: number; name: string }
declare function normalizeName(name: string): string;

const incrementBy = (draft: CounterState, step: number): void => { draft.count += step; };
const renameTo = (draft: CounterState, title: string): void => { draft.name = normalizeName(title); };

class Counter extends Carburetor<CounterState> {
    public bump(step: number): void {
        this.update(incrementBy, step);
    }

    public rename(name: string): void {
        this.update(renameTo, name);
    }
}
// #endregion doc

void Counter;

// #region doc
import {Carburetor} from 'react-carburetor';

interface CounterState { count: number; name: string }
declare function normalizeName(name: string): string;

const increment = (draft: CounterState): void => { draft.count += 1; };

class Counter extends Carburetor<CounterState> {
    public bump(step: number): void {
        this.draft.count += step;
        this.emitUpdate();
    }

    public rename(name: string): void {
        try {
            this.draft.name = normalizeName(name);
        } finally {
            this.emitUpdate();
        }
    }

    public increment(): void {
        this.update(increment);
    }
}
// #endregion doc

void Counter;

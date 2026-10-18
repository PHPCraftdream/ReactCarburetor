import {Carburetor} from 'react-carburetor';

// #region doc
const incrementBy = (draft: {count: number}, step: number): void => {
    draft.count += step;
};

class Counter extends Carburetor<{count: number}> {
    public bump(step: number): void {
        this.update(incrementBy, step);
    }
}
// #endregion doc

void Counter;

import {Carburetor} from 'react-carburetor';

// #region doc
const increment = (draft: {count: number}): void => {
    draft.count += 1;
};

class Counter extends Carburetor<{count: number}> {
    public increment(): void {
        this.update(increment);
    }
}
// #endregion doc

void Counter;

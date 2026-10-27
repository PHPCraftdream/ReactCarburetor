import {Carburetor} from '@react-carburetor/core';

export class Counter extends Carburetor<{count: number}> {
    // #region doc
    public bump(step: number): void {
        this.update((draft) => {
            draft.count += step;
        });
    }
    // #endregion doc
}

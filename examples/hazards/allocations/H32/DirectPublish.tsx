import {Carburetor} from '@react-carburetor/core';

export class Counter extends Carburetor<{count: number}> {
    // #region doc
    public bump(step: number): void {
        this.draft.count += step;
        this.emitUpdate();
    }
    // #endregion doc
}

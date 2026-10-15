import {Carburetor} from 'react-carburetor';

export class WrongIndex extends Carburetor<{index: Map<string, number>}> {
    public set(id: string): void {
        // #region doc
        this.update(draft => {
            draft.index.set(id, 1);      // index is a Map
        });
        // #endregion doc
    }
}

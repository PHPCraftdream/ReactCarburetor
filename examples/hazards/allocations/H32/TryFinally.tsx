import {Carburetor} from 'react-carburetor';

declare function normalizeName(name: string): string;

export class Profile extends Carburetor<{name: string}> {
    // #region doc
    public rename(name: string): void {
        try {
            this.draft.name = normalizeName(name);
        } finally {
            this.emitUpdate();
        }
    }
    // #endregion doc
}

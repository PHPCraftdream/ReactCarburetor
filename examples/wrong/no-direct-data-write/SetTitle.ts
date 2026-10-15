import {Carburetor} from 'react-carburetor';

export class WrongTitle extends Carburetor<{title: string}> {
    // #region doc
    public setTitle = (title: string) => {
        this.data.title = title;

        this.emitUpdate();
    };
    // #endregion doc
}

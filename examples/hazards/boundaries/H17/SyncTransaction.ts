import {Carburetor, transaction} from 'react-carburetor';

declare function save(): Promise<void>;

class Profile extends Carburetor<{name: string}> {
    public setName(name: string): void {
        this.draft.name = name;
        this.emitUpdate();
    }
}

const profileCarburetor = new Profile({name: ''});

export async function demo(name: string): Promise<void> {
    // #region doc
    await save();

    transaction(() => {
        profileCarburetor.setName(name);
    });
    // #endregion doc
}

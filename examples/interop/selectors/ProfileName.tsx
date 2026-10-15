// #region name
import type {ReactElement} from 'react';
import {Carburetor, bind} from 'react-carburetor';
import {useCarburetorValue} from 'react-carburetor/interop';

class ProfileCarburetor extends Carburetor<{name: string; email: string}> {
    public constructor() {
        super({name: 'Ada Lovelace', email: 'ada@example.com'});
    }

    @bind
    public rename(name: string): void {
        this.draft.name = name;
        this.emitUpdate();
    }
}

const profile = new ProfileCarburetor();

const selectName = (profile: {name: string; email: string}): string => profile.name;

function ProfileName(): ReactElement {
    const name = useCarburetorValue(profile, selectName);
    return <span>{name}</span>;
}
// #endregion name
void ProfileName;

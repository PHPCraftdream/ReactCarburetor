// #region label
import type {ReactElement} from 'react';
import {Carburetor} from 'react-carburetor';
import {TValueComparator, useCarburetorValue} from 'react-carburetor/interop';

class ProfileCarburetor extends Carburetor<{name: string; email: string}> {
    public constructor() {
        super({name: 'Ada Lovelace', email: 'ada@example.com'});
    }
}

const profile = new ProfileCarburetor();

const sameLabel: TValueComparator<{label: string}> =
    (a, b) => a.label === b.label;

const selectLabel = (p: {name: string; email: string}): {label: string} => ({label: p.name.toUpperCase()});

function ProfileLabel(): ReactElement {
    const view = useCarburetorValue(
        profile,
        selectLabel,
        sameLabel,
    );
    return <span>{view.label}</span>;
}
// #endregion label
void ProfileLabel;

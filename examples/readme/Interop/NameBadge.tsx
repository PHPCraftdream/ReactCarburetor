import type {Carburetor} from '@react-carburetor/core';

declare const profileCarburetor: Carburetor<{name: string}>;

// #region nameBadge
import {useCarburetorValue, useComputedValue} from '@react-carburetor/core/interop';

const selectProfileName = (data: {name: string}) => data.name;

const NameBadge = () => {
    const name = useCarburetorValue(profileCarburetor, selectProfileName);

    return <span>{name}</span>;
};
// #endregion nameBadge

void useComputedValue;
void NameBadge;

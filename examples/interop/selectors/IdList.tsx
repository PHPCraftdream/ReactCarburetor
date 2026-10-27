// #region ids
import type {ReactElement} from 'react';
import {Carburetor} from '@react-carburetor/core';
import {TSelector, TValueComparator, useCarburetorValue} from '@react-carburetor/core/interop';

class SelectionCarburetor extends Carburetor<{ids: number[]}> {
    public constructor() {
        super({ids: [1, 2, 3]});
    }
}

const selection = new SelectionCarburetor();

const selectIds: TSelector<{ids: number[]}, readonly number[]> = (view) => view.ids;

const sameIds: TValueComparator<readonly number[]> = (a, b) =>
    a.length === b.length && a.every((id, index) => id === b[index]);

const renderId = (id: number): ReactElement => <li key={id}>{id}</li>;
function IdList(): ReactElement {
    const ids = useCarburetorValue(selection, selectIds, sameIds);
    return <ul>{ids.map(renderId)}</ul>;
}
// #endregion ids
void IdList;

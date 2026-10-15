// #region shared
import {TSelector, TValueComparator} from 'react-carburetor/interop';

interface Settings {
    ids: number[];
    title: string;
}

export const selectIds: TSelector<Settings, readonly number[]> = (view) => view.ids;

export const sameIds: TValueComparator<readonly number[]> = (a, b) =>
    a.length === b.length && a.every((id, index) => id === b[index]);
// #endregion shared

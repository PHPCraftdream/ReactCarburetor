import type {IDict, IResourceEntry} from '@react-carburetor/core';
// #region doc
interface IResourceCacheData<T> {
    entries: IDict<IResourceEntry<T>>;
}
// #endregion doc

// Referenced here so the documented interface needs no underscore prefix.
export type CacheShapeUsed = IResourceCacheData<unknown>;

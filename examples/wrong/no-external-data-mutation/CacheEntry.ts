import {ResourceCache} from '@react-carburetor/core';

interface IUser {name: string}

declare function loadUser(id: string): Promise<IUser>;

const userCache = new ResourceCache<IUser, [string]>(loadUser);
const id = 'a';

// #region doc
userCache.getEntry(id).data.name = 'edited';
// #endregion doc

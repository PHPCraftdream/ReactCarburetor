import {ResourceCache} from 'react-carburetor';

interface IUser {name: string}

declare function loadUser(args: {id: string; onDone?: (id: string) => void}): Promise<IUser>;
declare function refresh(id: string): void;

const userCache = new ResourceCache<IUser, [{id: string; onDone?: (id: string) => void}]>(loadUser);

export function demo(id: string): void {
    // #region doc
    userCache.load({id, onDone: () => refresh(id)});
    // #endregion doc
}

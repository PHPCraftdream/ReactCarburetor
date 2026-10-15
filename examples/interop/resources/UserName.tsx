// #region name
import type {ReactElement} from 'react';
import {ResourceCache} from 'react-carburetor';
import {useResourceValue} from 'react-carburetor/interop';

interface User {
    id: number;
    name: string;
}

declare function fetchUser(id: number): Promise<User>;

const userCache = new ResourceCache<User, number>(async (id) => fetchUser(id));

const selectUserName = (entry: {data?: User}): string | undefined => entry.data?.name;

function UserName({userId}: {userId: number}): ReactElement {
    const name = useResourceValue(userCache, userId, selectUserName);
    return <span>{name ?? '…'}</span>;
}
// #endregion name
void UserName;

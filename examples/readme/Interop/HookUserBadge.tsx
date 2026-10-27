import {ResourceCache} from '@react-carburetor/core';

interface User {id: string; name: string}

const users = new ResourceCache<User, [string]>(async (id, signal) => {
    const response = await fetch(`/api/users/${id}`, {signal});
    if (!response.ok) throw new Error(`User request failed: ${response.status}`);
    return response.json() as Promise<User>;
}, {ttl: 30_000, maxEntries: 200});

// #region hookUserBadge
import type {IResourceView, TReadonly} from '@react-carburetor/core';
import {useResourceValue} from '@react-carburetor/core/interop';

const selectUserBadge = (view: TReadonly<IResourceView<User>>) =>
    view.data === undefined ? undefined : {name: view.data.name};

const HookUserBadge = ({id}: {id: string}) => {
    const user = useResourceValue(users, [id], selectUserBadge);

    return <span>{user?.name ?? '…'}</span>;
};
// #endregion hookUserBadge

void HookUserBadge;

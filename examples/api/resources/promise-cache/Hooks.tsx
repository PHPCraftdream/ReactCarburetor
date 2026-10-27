import {ResourceCache} from '@react-carburetor/core';

interface User {
    id: string;
    name: string;
}
const users = new ResourceCache<User, [string]>(async (id) => ({id, name: `User ${id}`}));
// #region doc
import {IResourceView, TReadonly} from '@react-carburetor/core';
import {useResourceValue} from '@react-carburetor/core/interop';

const selectName = (view: TReadonly<IResourceView<User>>) => view.data?.name;
function UserName({id}: {id: string}) {
    const name = useResourceValue(users, [id], selectName);
    return <span>{name ?? 'loading'}</span>;
}
// #endregion doc
void UserName;

import {AntiHookComponent, ResourceCache} from 'react-carburetor';

interface IUser {name: string}

declare function loadUser(id: string): Promise<IUser>;

const userCache = new ResourceCache<IUser, [string]>(loadUser);

class Reader extends AntiHookComponent<{id: string}> {
    public render() {
        const view = this.useResource(userCache, this.props.id);

        return <span>{view.data?.name}</span>;
    }
}

void Reader;

export class WrongCacheLoad extends AntiHookComponent<{id: string}> {
    // #region doc
    public render() {
        void userCache.load(this.props.id);

        return <span>{userCache.getEntry(this.props.id).data?.name}</span>;
    }
    // #endregion doc
}

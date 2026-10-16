// #region load
import {AntiHookComponent, bind, ResourceCarburetor, TResourceLoader} from 'react-carburetor';
import {type JSX} from 'react';

interface User {
    id: string;
    name: string;
}

declare function fetchUser(id: string): Promise<User>;

const userLoader: TResourceLoader<User, [string]> = (id: string, signal: AbortSignal) =>
    fetchUser(id).then((user: User) => {
        if (signal.aborted) {
            throw new Error('aborted');
        }
        return user;
    });

const userResource = new ResourceCarburetor<User, [string]>(userLoader);

export class UserProfile extends AntiHookComponent<{userId: string}> {
    @bind
    private loadUser(id: string): void {
        void userResource.load(id);
    }

    @bind
    private loadProfile(): void {
        this.loadUser(this.props.userId);
    }

    render(): JSX.Element {
        const view = this.useCarburetor(userResource);

        if (view.isPending) {
            return <span className="spinner">Loading…</span>;
        }
        if (view.isError) {
            return <span className="error">{view.error}</span>;
        }
        if (view.isSuccess && view.data !== undefined) {
            return <h1>{view.data.name}</h1>;
        }
        return (
            <button type="button" onClick={this.loadProfile}>
                Load profile
            </button>
        );
    }
}
// #endregion load

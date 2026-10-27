import {AntiHookComponent} from '@react-carburetor/core';
import {profile} from './Resource';

interface IProfile {name: string}

class ProfileCard extends AntiHookComponent<{profile: IProfile; refreshing: boolean}> {
    public render(): null {
        return null;
    }
}

export class ProfileView extends AntiHookComponent {
    // #region suspend
    render() {
        const view = this.useCarburetor(profile);

        return <ProfileCard profile={profile.suspend({id: 'a1'})} refreshing={view.isPending}/>;
    }
    // #endregion suspend
}

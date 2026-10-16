import {ResourceCarburetor} from 'react-carburetor';

interface IProfile {name: string}

// #region profile
const parseProfile = (response: Response): Promise<IProfile> => response.json();

export const profile = new ResourceCarburetor<IProfile, [{id: string}]>(
    ({id}, signal) => fetch(`/api/profile/${id}`, {signal}).then(parseProfile)
);

await profile.load({id: 'a1'});   // EResourceStatus.Pending -> Success | Error
// #endregion profile

// #region isError
if (profile.getData().isError) {
    // handle the error state
}
// #endregion isError

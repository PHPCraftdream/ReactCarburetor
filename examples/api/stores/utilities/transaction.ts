// #region transaction
import {Carburetor, transaction} from '@react-carburetor/core';

const profile = new Carburetor({name: 'ada'});
const settings = new Carburetor({theme: 'light'});

// Both stores' writes land before any subscriber runs: observers see the
// consistent pair, never the intermediate state.
transaction(() => {
    profile.setData({name: 'grace'});
    settings.setData({theme: 'dark'});
});

console.log(profile.getData().name, settings.getData().theme); // 'grace dark'
// #endregion transaction

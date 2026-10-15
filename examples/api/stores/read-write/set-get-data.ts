// #region set-get-data
import {Carburetor} from 'react-carburetor';

const store = new Carburetor({items: ['a'], done: false});

const current = store.getData();        // raw, untracked state — reads subscribe to nothing
store.setData({...current, done: true}); // adopts the new root wholesale
// #endregion set-get-data

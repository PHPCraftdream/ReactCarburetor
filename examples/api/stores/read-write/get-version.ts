// #region get-version
import {Carburetor} from 'react-carburetor';

const store = new Carburetor({value: 0});

const before: number = store.getVersion();
store.setData({value: 1});
const after: number = store.getVersion();

console.log(after > before); // true: every published write bumps the version
// #endregion get-version

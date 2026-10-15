// #region deep-clone
import {Carburetor, deepClone} from 'react-carburetor';

const store = new Carburetor({profile: {name: 'ada'}});

const offline = deepClone(store.getData()); // a standalone copy, no store involved
offline.profile.name = 'local edit';

console.log(store.getData().profile.name); // 'ada' — untouched
// #endregion deep-clone

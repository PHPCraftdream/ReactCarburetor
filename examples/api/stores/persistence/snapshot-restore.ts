// #region snapshot-restore
import {Carburetor} from 'react-carburetor';

const store = new Carburetor({count: 1, tags: ['a']});

const checkpoint = store.snapshot();
store.setData({...checkpoint, count: 99, tags: [...checkpoint.tags, 'b']});
console.log(checkpoint.tags.length); // 1 — the snapshot is detached

store.restore(checkpoint);
console.log(store.getData()); // {count: 1, tags: ['a']}
// #endregion snapshot-restore

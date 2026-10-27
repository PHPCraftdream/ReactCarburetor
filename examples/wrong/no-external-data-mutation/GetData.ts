import {Carburetor} from '@react-carburetor/core';

class Todos extends Carburetor<{items: Record<string, {done: boolean}>}> {}

const todoCarburetor = new Todos({items: {a: {done: false}}});
const id = 'a';

// #region doc
todoCarburetor.getData().items[id].done = true;
// #endregion doc

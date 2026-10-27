// #region read-api
import {Carburetor} from '@react-carburetor/core';

const store = new Carburetor({user: {name: 'ada', age: 36}});

const readPaths: string[] = [];
const view = store.read((path) => readPaths.push(path));
const name: string = view.user.name;

console.log(name);       // 'ada'
console.log(readPaths);  // ['user', 'user.name'] — exactly what the read touched
// #endregion read-api

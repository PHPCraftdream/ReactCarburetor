// #region shallow-equal
import {shallowEqual} from '@react-carburetor/core';

console.log(shallowEqual({a: 1, b: 2}, {a: 1, b: 2}));  // true
console.log(shallowEqual({a: {b: 1}}, {a: {b: 1}}));    // false: nested objects by reference
console.log(shallowEqual([1, 2], [1, 2]));              // true: arrays get a dedicated loop
// #endregion shallow-equal

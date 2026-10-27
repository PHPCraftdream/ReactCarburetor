import {Carburetor, ICarburetor} from '@react-carburetor/core';

interface State {value: number}
const store = new Carburetor<State>({value: 0});
const patch = {value: 1};
const update = (target: ICarburetor<State>): void => { target.setData(patch); };
update(store);
store.getData();

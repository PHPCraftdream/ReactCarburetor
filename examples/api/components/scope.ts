import {Carburetor, CarburetorScope, ICarburetorToken, carburetorToken} from '@react-carburetor/core';

interface State {count: number}
const countToken: ICarburetorToken<Carburetor<State>> = carburetorToken(() => new Carburetor({count: 0}), 'example-count');
const scope = new CarburetorScope();
const counter = scope.get(countToken);
const initial = counter.getData().count;
counter.setData({count: initial + 1});
const state = scope.dehydrate();
const hydrated = new CarburetorScope();
hydrated.hydrate(state, [countToken]);
void hydrated.get(countToken);

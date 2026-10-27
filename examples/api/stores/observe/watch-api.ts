// #region watch-api
import {Carburetor, TDisposer, TReadonly, TSelector} from '@react-carburetor/core';

const store = new Carburetor({items: [{done: false}, {done: true}]});

const isDone = (item: {done: boolean}): boolean => item.done;
const select: TSelector<{items: {done: boolean}[]}, number> = (data) => data.items.filter(isDone).length;

const disposer: TDisposer = store.watch(
    select,
    (next: TReadonly<number>, previous: TReadonly<number>) => {
        console.log(previous, '->', next);
    }
);

store.setData({items: [{done: true}, {done: true}]}); // selection changes 1 -> 2, so onChange fires

disposer(); // stop watching; never fires again
// #endregion watch-api

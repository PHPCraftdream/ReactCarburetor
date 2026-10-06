/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R31-01 + R31-05: Map/Set equality compares iteration order and Object.is Date timestamps, so a
// reordering is a visible change and an equal Invalid Date is not. No args.
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor} = await load();
const state = (map, set, tick, date) => ({map, set, tick, date});
const store = new Carburetor(state(new Map([['a', 1], ['b', 2]]), new Set(['a', 'b']), 0, new Date(Number.NaN)));

let mapSameOrder = 0;
let stopWatch = store.watch(view => view.map, () => { mapSameOrder++; });
store.setData(state(new Map([['a', 1], ['b', 2]]), store.getData().set, store.getData().tick, store.getData().date));
stopWatch();

let mapReorder = 0;
stopWatch = store.watch(view => view.map, () => { mapReorder++; });
store.setData(state(new Map([['b', 2], ['a', 1]]), store.getData().set, store.getData().tick, store.getData().date));
stopWatch();

let setReorder = 0;
stopWatch = store.watch(view => view.set, () => { setReorder++; });
store.setData(state(store.getData().map, new Set(['b', 'a']), store.getData().tick, store.getData().date));
stopWatch();

let invalidDateSame = 0;
stopWatch = store.watch(view => ({tick: view.tick % 2, date: view.date}), () => { invalidDateSame++; });
store.setData(state(store.getData().map, store.getData().set, 2, new Date(Number.NaN)));
stopWatch();

let invalidToValid = 0;
stopWatch = store.watch(view => ({tick: view.tick % 2, date: view.date}), () => { invalidToValid++; });
store.setData(state(store.getData().map, store.getData().set, 2, new Date(0)));
stopWatch();

emit({
    mapSameOrder, mapReorder, setReorder, invalidDateSame, invalidToValid,
    liveMapOrder: [...store.getData().map.keys()].join(','), liveSetOrder: [...store.getData().set].join(','),
});

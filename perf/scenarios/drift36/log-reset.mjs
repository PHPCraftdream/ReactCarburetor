/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {emit, load, countWriteLogMatches} from '../../harness/lib.mjs';

const {Carburetor, computed} = await load();
class Store extends Carburetor { run(fn) { this.update(fn); } }
const store = new Store({items: Array.from({length: 10000}, (_, id) => ({id, done: id % 2 === 0})), meta: {}});
const matches = countWriteLogMatches(store);
let recomputes = 0;
const value = computed(read => { recomputes++; return read(store).items.filter(row => !row.done).length; });
const id = value.subscribe(() => undefined);
value.get();
store.run(draft => { for (let i = 0; i < 9000; i++) draft.meta[`k${i}`] = i; });
const beforeRuns = recomputes;
const result = value.get();
const recomputeDelta = recomputes - beforeRuns;
emit({recomputes: recomputeDelta, writeLogConsultations: matches.calls, result});
value.unsubscribe(id);

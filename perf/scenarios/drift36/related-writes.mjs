/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R36-03: related writes to an observed computed are answered from the filed record, not the write log.
// The control asks the same store through an unfiled copy of the read set: the log must be consulted.
import {countWriteLogMatches, emit, load} from '../../harness/lib.mjs';

const {Carburetor, computed} = await load();
const HAS_DRIFT = Symbol.for('react-carburetor/v1/subscription-has-drift');
class Store extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 10000);
const writes = Number(process.argv[3] ?? 21);
const store = new Store({items: Array.from({length: rows}, (_, id) => ({id, done: false}))});
const matches = countWriteLogMatches(store);
const open = computed(read => read(store).items.filter(row => !row.done).length);
let wakes = 0;
const id = open.subscribe(() => { wakes++; });

matches.calls = 0;
for (let i = 0; i < writes; i++) {
    const index = (i * 997) % rows;
    store.run(draft => { draft.items[index].done = !draft.items[index].done; });
    open.get();
}
const writeLogConsultations = matches.calls;
const wakesAfterWrites = wakes;
const result = open.get();

// Positive control: a read set the store never filed has no record, so the log answers.
matches.calls = 0;
const baseline = store.getVersion();
store.run(draft => { draft.items[0].done = !draft.items[0].done; });
const unfiledAnswer = store[HAS_DRIFT](baseline, new Set(['items.0.done']));
const controlConsultations = matches.calls;

emit({writeLogConsultations, controlConsultations, unfiledAnswer, wakes: wakesAfterWrites, result});
open.unsubscribe(id);

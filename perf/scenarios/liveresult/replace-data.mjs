/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R35-01: a computed whose result is a live view of store data follows setData/fromJSON, which swap
// the data object while recording only the leaves that differ; a primitive result does not re-run.
// Args: [rows=10000] [samples=200]
import {emit, load, median} from '../../harness/lib.mjs';

const {Carburetor, computed} = await load();

const rows = Number(process.argv[2] ?? 10000);
const samples = Number(process.argv[3] ?? 200);
const make = () => new Carburetor({
    rows: Array.from({length: rows}, (_, id) => ({id, title: 'T' + id})), other: 0,
});
const edited = (s, title) => {
    const next = s.snapshot();
    next.rows[rows - 1].title = title;
    return next;
};

const s = make();
let liveRuns = 0;
const live = computed(read => { liveRuns++; return read(s).rows; });
live.subscribe(() => {});
void live.get()[0].title;
const runsBefore = liveRuns;
s.setData(edited(s, 'set'));
const seenAfterSetData = live.get()[rows - 1].title;
const runsAfter = liveRuns;
s.fromJSON(edited(s, 'json'));
const seenAfterFromJson = live.get()[rows - 1].title;

let primitiveRuns = 0;
const primitive = computed(read => { primitiveRuns++; return read(s).other * 2; });
primitive.subscribe(() => {});
primitive.get();
const primitiveBefore = primitiveRuns;
s.setData(edited(s, 'again'));
primitive.get();
const primitiveRunsOnSetData = primitiveRuns - primitiveBefore;

const times = [];
for (let i = 0; i < samples; i++) {
    s.update(d => { d.other = i + 1; });
    const start = performance.now();
    live.get();
    times.push(performance.now() - start);
}

emit({
    seenAfterSetData, seenAfterFromJson, liveRunsOnSetData: runsAfter - runsBefore,
    primitiveRunsOnSetData, getMs: median(times),
    seenAfterEdit: live.get()[rows - 1].title,
});

/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R33-01: a computed returning a live branch (read(s).rows) must not have the branch walked
// through read proxies on settle. Args: [rows=10000] [samples=9]
import {emit, load, median} from '../../harness/lib.mjs';

const {Carburetor, computed} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 10000);
const samples = Number(process.argv[3] ?? 9);
const s = new S({rows: Array.from({length: rows}, (_, id) => ({id, title: 't0', tags: {a: 1}}))});
let wakes = 0;
const c = computed(read => read(s).rows);
c.subscribe(() => {
    void c.get()[5].title;
    wakes++;
});
void c.get()[5].title;

const times = [];
for (let i = 0; i < samples; i++) {
    global.gc?.();
    const start = performance.now();
    s.run(d => { d.rows[5].title = 'x' + i; });
    times.push(performance.now() - start);
}
const title = c.get()[5].title;
const timedWakes = wakes;

// Mechanism probe: one more edit with both enumeration primitives instrumented over row objects
// (the exotic walk), plus a snapshot control proving the instrumentation sees engine walks.
const rowWalks = fn => {
    const originalOwnKeys = Reflect.ownKeys;
    const originalKeys = Object.keys;
    const isRow = value => value !== null && typeof value === 'object' && !Array.isArray(value)
        && Object.prototype.hasOwnProperty.call(value, 'id')
        && Object.prototype.hasOwnProperty.call(value, 'title');
    let walks = 0;
    Reflect.ownKeys = target => { if (isRow(target)) walks++; return originalOwnKeys(target); };
    Object.keys = target => { if (isRow(target)) walks++; return originalKeys(target); };
    try {
        return fn(() => walks);
    } finally {
        Reflect.ownKeys = originalOwnKeys;
        Object.keys = originalKeys;
    }
};
const settleWalks = rowWalks(get => { s.run(d => { d.rows[5].title = 'probe'; }); return get(); });
const controlRowWalks = rowWalks(get => { s.snapshot(); return get(); });

emit({settleMs: median(times), settleWalks, controlRowWalks, wakes: timedWakes, title});

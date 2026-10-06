/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R37-03: the filed read set must stay bounded while a replaced subtree cycles through object and
// primitive shapes. 16 and 64 object→primitive payload cycles file a constant set; a genuinely
// growing payload proves the counter still sees growth. Args: [writes=1]
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor} = await load();

class Filing extends Carburetor {
    maxFiled = 0;
    edit(fn) { this.update(fn); }
    subscribe(callback, options) {
        const size = options?.reads?.size ?? 0;
        if (size > this.maxFiled) this.maxFiled = size;
        return super.subscribe(callback, options);
    }
}

const payload = (cycle, fields) => {
    const value = {};
    for (let field = 0; field < fields; field++) value[`c${cycle}f${field}`] = field;
    return value;
};

// Each cycle replaces the payload with a fresh 16-field object, then with the primitive 0 again.
const cycles = (store, count) => {
    let wakes = 0;
    let last = null;
    const stop = store.watch(d => d.rows, next => { wakes++; last = next; });
    for (let cycle = 0; cycle < count; cycle++) {
        store.edit(d => { d.rows[0].payload = payload(cycle, 16); });
        store.edit(d => { d.rows[0].payload = 0; });
    }
    stop();
    return {wakes, last, filed: store.maxFiled};
};

// Control: the payload genuinely grows, so the filed set must grow with it.
const growing = (store, count) => {
    let wakes = 0;
    const stop = store.watch(d => d.rows, () => { wakes++; });
    let current = {};
    for (let cycle = 0; cycle < count; cycle++) {
        current = {...current, [`k${cycle}`]: cycle};
        const fresh = current;
        store.edit(d => { d.rows[0].payload = fresh; });
    }
    stop();
    return {wakes, filed: store.maxFiled};
};

const at16 = cycles(new Filing({rows: [{payload: 0}], other: 0}), 16);
const at64 = cycles(new Filing({rows: [{payload: 0}], other: 0}), 64);
const control = growing(new Filing({rows: [{payload: 0}], other: 0}), 32);

emit({
    paths16: at16.filed,
    paths64: at64.filed,
    controlPaths: control.filed,
    delivered: `${at16.wakes}|${at64.wakes}|${control.wakes}`,
    done: at16.last[0].payload === 0 && at64.last[0].payload === 0,
});

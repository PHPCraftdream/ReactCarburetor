/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// JS-R13-04: settled consumer pulls exclude publication and fixture work.
export const countPullKeys = (Carburetor, computed, consumers) => {
    class Store extends Carburetor { bump() { this.update(d => { d.count++; }); } }
    const store = new Store({count: 0});
    const source = computed(read => read(store).count);
    for (let i = 0; i < consumers; i++) source.subscribe(() => {});
    const keys = Object.keys;
    const count = fn => {
        let calls = 0;
        Object.keys = value => { calls++; return keys(value); };
        try { const value = fn(); return {total: calls, ...value}; }
        finally { Object.keys = keys; }
    };
    const empty = count(() => ({})).total;
    const cold = computed(read => read(store).count);
    const control = count(() => ({value: cold.get()}));
    let calls = 0;
    let value = 0;
    for (let wave = 0; wave < 5; wave++) {
        store.bump();
        const sample = count(() => {
            for (let i = 0; i < consumers; i++) value = source.get();
            return {value};
        });
        calls += sample.total;
    }
    return {calls, empty, control: control.total, value};
};

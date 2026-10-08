/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {load} from '../../harness/lib.mjs';
const {Carburetor, CarburetorHistory} = await load();
class Store extends Carburetor {
    write(value) { this.update(draft => { draft.rows[5].value = value; }); }
    replaceDate(date) { this.update(draft => { draft.date = date; }); }
}
const fixture = (rows, native = true) => {
    const state = {rows: Array.from({length: rows}, (_, id) => ({id, value: 0}))};
    state.alias = state.rows[5];
    if (native) {
        state.date = new Date(1234);
        state.map = new Map([[state.alias, state.alias], ['root', state]]);
        state.set = new Set([state.alias]);
    }
    const store = new Store(state);
    const history = new CarburetorHistory(store, {limit: 8});
    return {store, history};
};
const identities = store => {
    const data = store.getData();
    return {date: data.date, map: data.map, set: data.set, row: data.rows[5]};
};
const valid = (store, rows, value, held, dateTime = 1234) => {
    const data = store.getData();
    return data.rows.length === rows && data.rows.every((row, id) =>
        row.id === id && row.value === (id === 5 ? value : 0)) &&
        data.alias === data.rows[5] && (!data.map || (
            data.map.get(data.alias) === data.alias && data.map.get('root') === data &&
            data.set.has(data.alias) && data.set.size === 1 && data.map.size === 2 &&
            data.date.getTime() === dateTime)) && (!held || (
            data.date === held.date && data.map === held.map && data.set === held.set &&
            data.rows[5] === held.row));
};
const observe = store => {
    // subscribe copies literal paths, not object-identity aliases. Prove both zero and positive
    // answers on independent plain/native controls; keep controls out of timing/counter regions.
    const controls = [false, true].map(native => {
        const {store: control, history} = fixture(8, native);
        let aliasWakes = 0;
        const id = control.subscribe(() => { aliasWakes++; }, {reads: ['alias.value']});
        control.write(1);
        const rowPathWakes = aliasWakes;
        control.update(draft => { draft.alias.value = 2; });
        control.unsubscribe(id);
        history.disconnect();
        return {rowPathWakes, aliasPathWakes: aliasWakes - rowPathWakes,
            valid: valid(control, 8, 2)};
    });
    const counts = {wakes: 0, unrelatedWakes: 0, aliasWakes: 0,
        plainAliasControlWakes: controls[0].aliasPathWakes,
        nativeAliasControlWakes: controls[1].aliasPathWakes,
        aliasContractCorrect: controls.every(control => control.rowPathWakes === 0 &&
            control.aliasPathWakes === 1 && control.valid)};
    const rowId = store.subscribe(() => { counts.wakes++; }, {reads: ['rows.5.value']});
    const aliasId = store.subscribe(() => { counts.aliasWakes++; }, {reads: ['alias.value']});
    const unrelatedId = store.subscribe(() => { counts.unrelatedWakes++; }, {reads: ['rows.6.value']});
    counts.dispose = () => {
        store.unsubscribe(rowId);
        store.unsubscribe(aliasId);
        store.unsubscribe(unrelatedId);
    };
    return counts;
};
export default {fixture, identities, observe, valid};

import {Carburetor} from '@/Carburetor';
import {reconcileSelection} from '@/Carburetor/Store/Utils/Selection/reconcileSelection';
import {patchFromWriteLog} from '@/Carburetor/Store/Utils/Selection/Patch/patchFromWriteLog';
import {CARBURETOR_TRACK_TARGETS} from '@/Carburetor/Store/Utils/Models';
import {reuseSelection} from '@/Carburetor/Store/Utils/Selection/Patch/reuseSelection';

interface IData {rows: Array<{n: number}>; other: number;}
class SelectionStore extends Carburetor<IData> {
    public change(fn: (draft: IData) => void): void { this.update(fn); }
}

describe('patchFromWriteLog and reuseSelection', () => {
    test('patches selected primitive changes, and refuses an incomplete write log', () => {
        const store = new SelectionStore({rows: [{n: 1}, {n: 2}], other: 0});
        const selected = store.read(() => undefined).rows;
        const ledger = new WeakMap<object, unknown>();
        const previous = reconcileSelection<Array<{n: number}>>(
            undefined,
            selected,
            undefined,
            undefined,
            undefined,
            ledger,
        );
        const baseline = store.getVersion();
        const releaseTargets = store[CARBURETOR_TRACK_TARGETS]();
        store.change((draft) => {
            draft.rows[0].n = 5;
        });
        const next = store.read(() => undefined).rows;
        const result = patchFromWriteLog(store, baseline, previous, next, ledger, () => undefined);
        expect(result).toBeDefined();
        expect(result).not.toBe(previous);
        expect(result?.[0]).not.toBe(previous[0]);
        expect(result?.[0].n).toBe(5);
        expect(result?.[1]).toBe(previous[1]);
        releaseTargets();
    });

    test('reuses only when committed source, paths, and drift protocol permit it', () => {
        const store = new SelectionStore({rows: [{n: 1}], other: 0});
        const live = store.read(() => undefined).rows;
        const prior = reconcileSelection<Array<{n: number}>>(undefined, live);
        const connection = {committed: undefined, attemptEntry: undefined};
        expect(reuseSelection(connection, prior, live, new WeakMap(), true)).toBeUndefined();
    });
});

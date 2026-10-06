/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R37-02: a throwing patch observer must not truncate the already-applied replacement batch.
// Counters, not timings: every detailed patch must reach an independent observer and undo must
// restore the whole root, both with and without a throwing observer. The counting observer is
// publication-bearing (`publication: () => {}`) so it coexists with the patch-only thrower
// instead of silently replacing it in the registry.
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor, CarburetorHistory} = await load();

const run = withThrowing => {
    const store = new Carburetor({a: 0, b: 0, c: 0, d: 0});
    const history = new CarburetorHistory(store);
    const received = [];
    const counting = {
        patch: patch => {
            if (typeof patch !== 'symbol') received.push(patch);
        },
        publication: () => {},
    };
    const throwing = {
        patch: patch => {
            if (typeof patch !== 'symbol' && patch.segments?.at(-1) === 'b') throw new Error('observer-stop');
        },
    };
    if (withThrowing) var detachThrowing = store.attachPatchListener(throwing);
    store.attachPatchListener(counting);
    let threw = false;
    try {
        store.setData({a: 1, b: 1, c: 1, d: 1});
    } catch (error) {
        threw = error instanceof Error && error.message === 'observer-stop';
    }
    const installedOk = store.getData().a === 1 && store.getData().d === 1;
    const delivered = received.length;
    detachThrowing?.();
    const undoneOk = history.undo() === true
        && JSON.stringify(store.getData()) === JSON.stringify({a: 0, b: 0, c: 0, d: 0});
    const redoneOk = history.redo() === true
        && JSON.stringify(store.getData()) === JSON.stringify({a: 1, b: 1, c: 1, d: 1});
    history.disconnect();
    return {threw, delivered, installedOk, undoneOk, redoneOk};
};

const throwing = run(true);
const control = run(false);

emit({
    delivered: throwing.delivered,
    threwOriginalError: throwing.threw,
    installedOk: throwing.installedOk,
    undoneOk: throwing.undoneOk,
    redoneOk: throwing.redoneOk,
    controlDelivered: control.delivered,
    controlThrew: control.threw,
    controlUndoneOk: control.undoneOk,
});

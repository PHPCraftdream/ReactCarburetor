import {Carburetor} from '@/Carburetor';

interface ISharedData {
    a: {v: number};
    b: {v: number};
}

describe('restore with one shared raw object at two paths (R34-D)', () => {
    // The same plain object sits at both `a` and `b` in the store's raw state (legal aliasing
    // inside state, built before construction). The snapshot keeps `a` deep-equal to the shared
    // object but changes `b`, so the scan marks the previous/next pair of `a` unchanged while
    // `b` genuinely differs. A membership-only `Set` of previous objects skips BOTH paths and
    // leaves `b` stale; a previous->next `Map` skips only the truly equal pair, so `b`'s
    // difference is applied.
    //
    // Note on `a`: the leaf write for `b` descends into `b`'s draft, whose raw target IS the
    // shared object, so the shared raw ends at {v: 2} and `a` — the same raw object — reflects
    // it. Native application cannot split a shared reference; identity (not snapshot equality)
    // of `a` is what is preserved here.
    test('a shared reference equal at one path but differing at the other applies the difference', () => {
        const shared = {v: 1};
        const store = new Carburetor<ISharedData>({a: shared, b: shared});

        const snapshot: ISharedData = {a: {v: 1}, b: {v: 2}};
        store.restore(snapshot);

        // The genuinely differing path is applied (a Set of previous objects would skip it too).
        expect(store.getData().b.v).toEqual(2);
        // The unchanged path keeps its raw identity — no root replacement, no rewrap.
        expect(store.getData().a).toBe(shared);
        expect(store.getData()).not.toBe(snapshot);
    });
});

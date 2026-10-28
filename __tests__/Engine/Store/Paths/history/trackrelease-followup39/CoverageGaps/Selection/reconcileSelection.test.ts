import {reconcileSelection} from '@/Carburetor/Store/Utils/Selection/reconcileSelection';

describe('reconcileSelection edge topology', () => {
    test('primitive identity and changed values set a non-shared verdict', () => {
        const verdict = {shared: true};
        const prior = {x: 1};
        expect(reconcileSelection(prior, prior, undefined, undefined, undefined, undefined, verdict)).toBe(prior);
        expect(verdict.shared).toBe(false);
        expect(reconcileSelection(1, 2, undefined, undefined, undefined, undefined, verdict)).toBe(2);
        expect(verdict.shared).toBe(false);
    });

    test('flags shared references and preserves cycles', () => {
        const raw: {self?: unknown; child?: object} = {};
        raw.self = raw;
        const verdict = {shared: false};
        const copy = reconcileSelection<typeof raw>(
            undefined,
            raw,
            undefined,
            undefined,
            undefined,
            undefined,
            verdict,
        );
        expect(copy).not.toBe(raw);
        expect(copy.self).toBe(copy);
        expect(verdict.shared).toBe(true);
        const shared = {};
        const graph = {a: shared, b: shared};
        const result = reconcileSelection<{a: object; b: object}>(undefined, graph);
        expect(result.a).toBe(result.b);
    });
});

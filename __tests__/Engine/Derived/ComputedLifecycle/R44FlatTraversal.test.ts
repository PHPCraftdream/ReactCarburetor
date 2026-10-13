import {Carburetor, computed, transaction} from '@/Carburetor';
import {computedDependencies} from '@/Carburetor/Derived/computedDependencies';
import {ILeafVersion, IReadSet} from '@/Carburetor/Derived/Freshness/Models';
import {IDict} from '@/Carburetor/Models/Base';

const snapshot = (source: IReadSet['source']): IDict<ILeafVersion> =>
    computedDependencies.versions.get(source)!() as IDict<ILeafVersion>;

const contents = (versions: IDict<ILeafVersion>) => Object.entries(versions).map(([key, record]) => ({
    key, source: record.source, version: record.version, data: record.data,
    reads: record.reads && [...record.reads],
    parts: record.parts?.map(part => ({version: part.version, reads: [...part.reads]})),
}));

describe('R44-C01 flat snapshot traversal', () => {
    test.each([1, 4, 16])('K=%s with independent M, alias and direct controls', K => {
        for (const M of [1, 4, 16]) for (const direct of [false, true]) {
            const stores = Array.from({length: M}, (_, i) => new Carburetor({n: i + 1, noise: 0}));
            const tick = new Carburetor({n: 0});
            let groupRuns = 0, topRuns = 0;
            const aliasRuns = Array(K).fill(0);
            const group = computed(read => {
                groupRuns++;
                return stores.reduce((sum, store) => sum + read(store).n, 0);
            });
            const groupId = group.subscribe(() => {});
            const aliases = Array.from({length: K}, (_, i) => computed(read => {
                aliasRuns[i]++;
                return read(group) + i;
            }));
            const top = computed(read => {
                topRuns++;
                let sum = 0;
                for (let i = 0; i < K; i++) sum += direct ? read(group) + i : read(aliases[i]);
                return sum + read(tick).n;
            });
            const seen: number[] = [];
            const id = top.subscribe(() => seen.push(top.get()));
            try {
                const initial = K * M * (M + 1) / 2 + K * (K - 1) / 2;
                expect(top.get()).toBe(initial);
                const inputs = direct ? [group] : aliases;
                const dictionaries = inputs.map(snapshot);
                const targets = new Set(dictionaries);
                const old = [snapshot(group), ...dictionaries, snapshot(top)];
                const saved = old.map(contents);
                const keys = Object.keys;
                const uids = stores.map(store => store.getUID);
                const count = (body: () => void) => {
                    let calls = 0, entries = 0, uidCalls = 0;
                    Object.keys = object => {
                        const result = keys(object);
                        if (targets.has(object as IDict<ILeafVersion>)) { calls++; entries += result.length; }
                        return result;
                    };
                    stores.forEach((store, i) => { store.getUID = () => { uidCalls++; return uids[i].call(store); }; });
                    try { body(); return {calls, entries, uidCalls}; }
                    finally {
                        Object.keys = keys;
                        stores.forEach((store, i) => { store.getUID = uids[i]; });
                    }
                };
                expect(count(() => {})).toEqual({calls: 0, entries: 0, uidCalls: 0});
                expect(count(() => { for (let i = 0; i < 16; i++) top.get(); }))
                    .toEqual({calls: 0, entries: 0, uidCalls: 0});
                expect(count(() => {
                    dictionaries.forEach(dictionary => Object.keys(dictionary));
                    stores.forEach(store => store.getUID());
                })).toEqual({calls: inputs.length, entries: inputs.length * M, uidCalls: M});
                expect(count(() => { tick.update(draft => { draft.n++; }); top.get(); }))
                    .toEqual({calls: 1, entries: M, uidCalls: M});
                expect(top.get()).toBe(initial + 1);
                expect(groupRuns).toBe(1);
                expect(aliasRuns).toEqual(Array(K).fill(direct ? 0 : 1));
                expect(topRuns).toBe(2);
                expect(seen).toEqual([initial + 1]);
                expect(top.getVersion()).toBe(1);
                expect(Object.keys(snapshot(top))).toHaveLength(M + 1);
                stores.forEach(store => expect(snapshot(top)[':' + store.getUID()].reads).toBeDefined());
                stores[0].update(draft => { draft.noise++; });
                expect(top.get()).toBe(initial + 1);
                expect(topRuns).toBe(2);
                stores[0].update(draft => { draft.n++; });
                expect(top.get()).toBe(initial + 1 + K);
                expect(seen).toEqual([initial + 1, initial + 1 + K]);
                expect(top.getVersion()).toBe(2);
                old.forEach((dictionary, i) => expect(contents(dictionary)).toEqual(saved[i]));
            } finally { top.unsubscribe(id); group.unsubscribe(groupId); }
        }
    });

    test('distinct native snapshots still traverse every distinct leaf entry', () => {
        const stores = Array.from({length: 4}, () => new Carburetor({n: 1}));
        const inputs = Array.from({length: 4}, (_, i) => computed(read =>
            stores.reduce((sum, store) => sum + read(store).n, i)));
        const tick = new Carburetor({n: 0});
        const top = computed(read => inputs.reduce((sum, input) => sum + read(input), 0) + read(tick).n);
        const seen: number[] = [];
        const id = top.subscribe(() => seen.push(top.get()));
        try {
            expect(top.get()).toBe(22);
            const targets = new Set(inputs.map(snapshot));
            const keys = Object.keys;
            let entries = 0;
            Object.keys = object => {
                const result = keys(object);
                if (targets.has(object as IDict<ILeafVersion>)) entries += result.length;
                return result;
            };
            try { tick.update(draft => { draft.n++; }); top.get(); }
            finally { Object.keys = keys; }
            expect(entries).toBe(16);
            expect(top.get()).toBe(23);
            expect(seen).toEqual([23]);
            const record = snapshot(top)[':' + stores[0].getUID()];
            expect(record.parts).toHaveLength(4);
            stores[0].update(draft => { draft.n++; });
            expect(top.get()).toBe(27);
            expect(seen).toEqual([23, 27]);
            expect(top.getVersion()).toBe(2);
        } finally { top.unsubscribe(id); }
    });

    test('upstream eager refresh cannot advance an alias checkpoint for its old result', () => {
        const store = new Carburetor({a: 1, b: 2});
        const a = computed(read => read(store).a);
        const b = computed(read => read(store).b);
        const group = computed(read => read(a) + read(b));
        const alias = computed(read => read(group) * 2);
        const seen: number[] = [];
        const id = alias.subscribe(() => seen.push(alias.get()));
        try {
            expect(alias.get()).toBe(6);
            const old = snapshot(alias), saved = contents(old);
            const borrowed = Object.values(old)[0];
            const parts = borrowed.parts!.slice();
            transaction(() => {
                store.update(draft => { draft.a = 5; });
                expect(group.get()).toBe(7);
                expect(contents(old)).toEqual(saved);
                expect(alias.get()).toBe(14);
                expect(seen).toEqual([]);
                expect(alias.getVersion()).toBe(0);
                expect(borrowed.parts).toEqual(parts);
            });
            expect(alias.get()).toBe(14);
            expect(seen).toEqual([14]);
            expect(alias.getVersion()).toBe(1);
            expect(contents(old)).toEqual(saved);
            parts.forEach((part, i) => expect(borrowed.parts![i]).toBe(part));
        } finally { alias.unsubscribe(id); }
    });
});

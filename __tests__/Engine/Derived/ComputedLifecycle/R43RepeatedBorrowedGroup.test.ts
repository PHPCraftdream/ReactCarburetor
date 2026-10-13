import {Carburetor, computed} from '@/Carburetor';
import {ILeafVersion, IReadSet} from '@/Carburetor/Derived/Freshness/Models';
import {computedDependencies} from '@/Carburetor/Derived/computedDependencies';
import {IDict} from '@/Carburetor/Models/Base';

const snapshot = (source: IReadSet['source']): IDict<ILeafVersion> =>
    computedDependencies.versions.get(source)!() as IDict<ILeafVersion>;


const probes = <T>(keys: ReadonlySet<ReadonlySet<string>>, body: () => T): {gets: number; value: T} => {
    const get = Map.prototype.get;
    let gets = 0;
    Map.prototype.get = function counted(key) {
        if (keys.has(key)) gets++;
        return get.call(this, key);
    };
    try {
        const value = body();
        return {gets, value};
    } finally {
        Map.prototype.get = get;
    }
};


describe('R43 repeated borrowed merged capture', () => {
    test.each([1, 4, 8, 16])('K=%s independently scaled aliases scan common parts once', K => {
        for (const M of [4, 8, 16]) {
            for (const layout of ['bare-first', 'merged-first', 'distinct'] as const) {
                const data: Record<string, number> = {extra: 0, noise: 0};
                for (let i = 0; i < M; i++) data['p' + i] = i + 1;
                const store = new Carburetor(data);
                const extra = layout === 'distinct' ? new Carburetor({extra: 0}) : store;
                const leaves = Array.from({length: M}, (_, i) => computed(read => read(store)['p' + i]));
                let groupRuns = 0, topRuns = 0;
                const group = computed(read => {
                    groupRuns++;
                    return leaves.reduce((sum, leaf) => sum + read(leaf), 0);
                });
                const groupId = group.subscribe(() => {});
                const aliasRuns = Array(K).fill(0);
                const aliases = Array.from({length: K}, (_, i) => computed(read => {
                    aliasRuns[i]++;
                    return read(group) + i;
                }));
                const top = computed(read => {
                    topRuns++;
                    let e = layout === 'merged-first' ? 0 : read(extra).extra;
                    const sum = aliases.reduce((total, alias) => total + read(alias), 0);
                    if (layout === 'merged-first') e = read(extra).extra;
                    return sum + e;
                });
                const events: number[] = [];
                const topId = top.subscribe(() => events.push(top.get()));
                try {
                    const initial = K * M * (M + 1) / 2 + K * (K - 1) / 2;
                    expect(top.get()).toBe(initial);
                    const key = ':' + store.getUID();
                    const borrowed = snapshot(group)[key];
                    const parts = borrowed.parts!.slice();
                    const borrowedVersion = borrowed.version;
                    const borrowedData = borrowed.data;
                    expect(parts).toHaveLength(M);
                    for (const alias of aliases) expect(snapshot(alias)[key]).toBe(borrowed);
                    const old = snapshot(top);
                    const oldRecords = Object.values(old);
                    const oldParts = oldRecords.map(record => record.parts?.slice());
                    const oldVersions = oldRecords.map(record => record.version);
                    const oldData = oldRecords.map(record => record.data);
                    const common = new Set(parts.map(part => part.reads));
                    expect(probes(common, () => 0).gets).toBe(0);
                    const known = new Map(parts.map(part => [part.reads, part.version]));
                    expect(probes(common, () => {
                        for (const part of parts) known.get(part.reads);
                    }).gets).toBe(M);
                    const work = probes(common, () => {
                        extra.update(draft => { draft.extra++; });
                        return top.get();
                    });
                    expect(work.gets).toBe(layout === 'distinct' ? 0 : M);
                    expect(work.value).toBe(initial + 1);
                    expect(events).toEqual([initial + 1]);
                    expect(top.getVersion()).toBe(1);
                    expect(groupRuns).toBe(1);
                    expect(aliasRuns).toEqual(Array(K).fill(1));
                    expect(topRuns).toBe(2);
                    const current = Object.values(snapshot(top));
                    expect(current.reduce((count, record) => count + (record.parts?.length ?? 1), 0)).toBe(M + 1);
                    const captured = snapshot(top)[key];
                    for (const part of parts) {
                        expect((captured.parts ?? [captured]).filter(pair => pair.reads === part.reads
                            && pair.version === part.version)).toHaveLength(1);
                    }
                    store.update(draft => { draft.noise++; });
                    expect(top.get()).toBe(initial + 1);
                    expect(topRuns).toBe(2);
                    expect(events).toEqual([initial + 1]);
                    store.update(draft => { draft.p0++; });
                    expect(top.get()).toBe(initial + 1 + K);
                    expect(top.getVersion()).toBe(2);
                    expect(events).toEqual([initial + 1, initial + 1 + K]);
                    expect(borrowed.parts).toEqual(parts);
                    parts.forEach((part, i) => expect(borrowed.parts![i]).toBe(part));
                    expect(borrowed.version).toBe(borrowedVersion);
                    expect(borrowed.data).toBe(borrowedData);
                    oldRecords.forEach((record, i) => {
                        expect(record.parts).toEqual(oldParts[i]);
                        oldParts[i]?.forEach((part, j) => expect(record.parts![j]).toBe(part));
                        expect(record.version).toBe(oldVersions[i]);
                        expect(record.data).toBe(oldData[i]);
                    });
                } finally {
                    top.unsubscribe(topId);
                    group.unsubscribe(groupId);
                }
            }
        }
    });

});

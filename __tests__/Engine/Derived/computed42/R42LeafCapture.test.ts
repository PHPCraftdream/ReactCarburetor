import {Carburetor, computed, transaction} from '@/Carburetor';
import {captureLeafVersions} from '@/Carburetor/Derived/Freshness/captureLeafVersions';
import {ILeafVersion, IReadSet} from '@/Carburetor/Derived/Freshness/Models';
import {computedDependencies} from '@/Carburetor/Derived/computedDependencies';
import {C} from '@/Carburetor/Derived/Models';
import {IDict} from '@/Carburetor/Models/Base';
import {IComputed} from '@/Carburetor/Models/Derived';

const snapshot = (source: IReadSet['source']): IDict<ILeafVersion> =>
    computedDependencies.versions.get(source)!() as IDict<ILeafVersion>;

const inner = (id: string, record: ILeafVersion): IReadSet => {
    const source = {
        getUID: () => id, getVersion: () => 0, subscribe: () => id, unsubscribe: () => {},
    };
    computedDependencies.versions.set(source, () => ({leaf: record}));
    return {source, reads: new Set(['*'])};
};

const fields = ['a', 'b', 'c', 'd'] as const;

describe('R42 lossless leaf capture', () => {
    test.each([false, true])('all sibling/nested orders and writes stay fresh, observed=%s', observed => {
        for (let order = 0; order < 8; order++) {
            for (const field of fields) {
                const store = new Carburetor({a: 1, b: 2, c: 3, d: 4, noise: 0});
                const runs = Array(8).fill(0);
                const leaves = fields.map((key, i) => computed(read => {
                    runs[i]++;
                    return read(store)[key];
                }));
                const left = computed(read => {
                    runs[4]++;
                    return order & 1 ? read(leaves[1]) + read(leaves[0]) : read(leaves[0]) + read(leaves[1]);
                });
                const right = computed(read => {
                    runs[5]++;
                    return order & 2 ? read(leaves[3]) + read(leaves[2]) : read(leaves[2]) + read(leaves[3]);
                });
                const pair = computed(read => {
                    runs[6]++;
                    return order & 4 ? read(right) + read(left) : read(left) + read(right);
                });
                const total = computed(read => { runs[7]++; return read(pair); });
                const seen: number[] = [];
                const id = observed ? total.subscribe(() => seen.push(total.get())) : undefined;
                try {
                    expect(total.get()).toBe(10);
                    const old = snapshot(total)[':' + store.getUID()];
                    const oldParts = old.parts!.slice();
                    const upstream = [snapshot(left), snapshot(right)].map(record => Object.values(record)[0]);
                    const upstreamParts = upstream.map(record => record.parts!.slice());
                    expect(old.parts).toHaveLength(4);
                    expect(old.parts!.map(part => [...part.reads][0]).sort()).toEqual(fields);
                    for (const leaf of leaves) {
                        const recorded = snapshot(leaf)[':' + store.getUID()];
                        expect(old.parts!.some(part => part.reads === recorded.reads
                            && part.version === recorded.version)).toBe(true);
                    }
                    const announcement = observed ? total[C.announced] : undefined;
                    const warmed = runs.slice();
                    store.update(draft => { draft.noise++; });
                    expect(total.get()).toBe(10);
                    expect(runs).toEqual(warmed);
                    expect(seen).toEqual([]);
                    transaction(() => {
                        store.update(draft => { draft[field] += 10; });
                        expect(total.get()).toBe(20);
                        expect(total.get()).toBe(20);
                        expect(seen).toEqual([]);
                        expect(total.getVersion()).toBe(0);
                        if (observed) expect(total[C.announced]).toBe(announcement);
                        expect(old.parts).toEqual(oldParts);
                        oldParts.forEach((part, i) => expect(old.parts![i]).toBe(part));
                        upstream.forEach((record, i) => expect(record.parts).toEqual(upstreamParts[i]));
                    });
                    expect(total.get()).toBe(20);
                    expect(seen).toEqual(observed ? [20] : []);
                    expect(total.getVersion()).toBe(observed ? 1 : 0);
                    expect(runs.slice(0, 4)).toEqual(fields.map(key => key === field ? 2 : 1));
                    const settled = runs.slice();
                    store.update(draft => { draft.noise++; });
                    expect(total.get()).toBe(20);
                    expect(runs).toEqual(settled);
                    expect(seen).toEqual(observed ? [20] : []);
                } finally {
                    if (id !== undefined) total.unsubscribe(id);
                }
            }
        }
    });

    test.each(['flat', 'merged-first', 'bare-first'] as const)('%s keeps precision and all paths', shape => {
        for (const field of fields) {
            const store = new Carburetor({a: 1, b: 2, c: 3, d: 4, noise: 0});
            const leaves = fields.map(key => computed(read => read(store)[key]));
            const left = computed(read => read(leaves[0]) + read(leaves[1]));
            let runs = 0;
            const total = computed(read => {
                runs++;
                if (shape === 'flat') return leaves.reduce((sum, leaf) => sum + read(leaf), 0);
                return shape === 'merged-first' ? read(left) + read(leaves[2]) + read(leaves[3])
                    : read(leaves[2]) + read(leaves[3]) + read(left);
            });
            expect(total.get()).toBe(10);
            store.update(draft => { draft.noise++; });
            expect(total.get()).toBe(10);
            expect(runs).toBe(1);
            store.update(draft => { draft[field] += 10; });
            expect(total.get()).toBe(20);
            expect(runs).toBe(2);
        }
    });

    test('overlapping groups and a repeated genuine record preserve every captured pair', () => {
        const store = new Carburetor({a: 1, b: 2, c: 3, noise: 0});
        const a = computed(read => read(store).a);
        const b = computed(read => read(store).b);
        const c = computed(read => read(store).c);
        const left = computed(read => read(a) + read(b));
        const right = computed(read => read(b) + read(c));
        const alias = computed(read => read(left));
        const total = computed(read => read(left) + read(alias) + read(right));
        expect(total.get()).toBe(11);
        const pairs = snapshot(total)[':' + store.getUID()].parts!;
        expect(pairs).toHaveLength(3);
        expect(new Set(pairs.map(pair => pair.reads)).size).toBe(3);
        for (const input of [left, right]) {
            for (const part of snapshot(input)[':' + store.getUID()].parts!) {
                expect(pairs.filter(pair => pair.reads === part.reads
                    && pair.version === part.version)).toHaveLength(1);
            }
        }
        store.update(draft => { draft.a += 10; });
        expect(total.get()).toBe(31);
        store.update(draft => { draft.c += 10; });
        expect(total.get()).toBe(41);
        store.update(draft => { draft.b += 10; });
        expect(total.get()).toBe(71);
    });

    test('one Set captured at different versions is not coalesced', () => {
        const store = new Carburetor({a: 1});
        const reads = new Set(['a']);
        const first: ILeafVersion = {source: store, version: 0, reads};
        const second: ILeafVersion = {source: store, version: 1, reads};
        const versions: IDict<ILeafVersion> = {};
        captureLeafVersions({
            a: inner('old', first), b: inner('new', second),
            c: inner('old-copy', {...first}), d: inner('new-copy', {...second}),
        }, versions);
        const parts = versions[':' + store.getUID()].parts!;
        expect(parts.map(part => part.version)).toEqual([0, 1]);
        expect(parts[0].reads).toBe(reads);
        expect(parts[1].reads).toBe(reads);
        expect(first.reads).toBe(reads);
        expect(first.parts).toBeUndefined();
    });

    test('26-node same-source diamond keeps two filed pairs and one final transaction delivery', () => {
        const store = new Carburetor({n: 0, noise: 0});
        const nodes: IComputed<number>[] = [];
        const runs = Array(26).fill(0);
        for (let index = 0; index < 26; index++) {
            nodes.push(computed(read => {
                runs[index]++;
                if (index < 2) return read(store).n + index;
                return read(nodes[index - 1]) + read(nodes[index - 2]);
            }));
        }
        const last = nodes[25];
        const key = ':' + store.getUID();
        const seen: number[] = [];
        const id = last.subscribe(() => seen.push(last.get()));
        const assertCoverage = (): void => {
            const seeds = nodes.slice(0, 2).map(node => snapshot(node)[key]);
            nodes.forEach((node, index) => {
                const record = snapshot(node)[key];
                const pairs = record.parts ?? [record];
                expect(pairs.length).toBeLessThanOrEqual(2);
                expect(pairs).toHaveLength(index < 2 ? 1 : 2);
                for (const seed of index < 2 ? [seeds[index]] : seeds) {
                    expect(pairs.filter(pair => pair.reads === seed.reads
                        && pair.version === seed.version)).toHaveLength(1);
                }
            });
        };
        try {
            expect(last.get()).toBe(75025);
            expect(runs).toEqual(Array(26).fill(1));
            assertCoverage();
            const old = snapshot(last)[key];
            const oldParts = old.parts!.slice();
            const oldReads = oldParts.map(part => [...part.reads]);
            const oldVersions = oldParts.map(part => part.version);
            const announcement = last[C.announced];
            store.update(draft => { draft.noise++; });
            expect(last.get()).toBe(75025);
            expect(runs).toEqual(Array(26).fill(1));
            expect(seen).toEqual([]);
            transaction(() => {
                store.update(draft => { draft.n = 1; });
                expect(last.get()).toBe(196418);
                expect(last.get()).toBe(196418);
                assertCoverage();
                expect(runs).toEqual(Array(26).fill(2));
                expect(last[C.announced]).toBe(announcement);
                expect(last.getVersion()).toBe(0);
                expect(seen).toEqual([]);
                store.update(draft => { draft.noise++; });
                expect(last.get()).toBe(196418);
                expect(runs).toEqual(Array(26).fill(2));
                store.update(draft => { draft.n = 2; });
                expect(last.get()).toBe(317811);
                expect(last.get()).toBe(317811);
                assertCoverage();
                expect(runs).toEqual(Array(26).fill(3));
                expect(last[C.announced]).toBe(announcement);
                expect(seen).toEqual([]);
            });
            expect(last.get()).toBe(317811);
            expect(last.getVersion()).toBe(1);
            expect(seen).toEqual([317811]);
            expect(runs).toEqual(Array(26).fill(3));
            assertCoverage();
            expect(snapshot(last)[key].parts).not.toBe(old.parts);
            expect(old.parts).toEqual(oldParts);
            oldParts.forEach((part, index) => {
                expect(old.parts![index]).toBe(part);
                expect(part.version).toBe(oldVersions[index]);
                expect([...part.reads]).toEqual(oldReads[index]);
            });
            store.update(draft => { draft.noise++; });
            expect(last.get()).toBe(317811);
            expect(runs).toEqual(Array(26).fill(3));
            expect(seen).toEqual([317811]);
        } finally {
            last.unsubscribe(id);
        }
    });

    test(
        'equal filed pairs deduplicate without truncating distinct Set identities or borrowing writable output', () => {
        const store = new Carburetor({a: 1, b: 2, c: 3, d: 4});
        const reads = fields.map(field => Object.freeze(new Set([field])));
        const parts = reads.map(read => Object.freeze({version: 0, reads: read}));
        const left = Object.freeze(parts.slice(0, 2));
        const right = Object.freeze(parts.slice(1));
        const first = Object.freeze({source: store, version: 0, parts: left});
        const second = Object.freeze({source: store, version: 0, parts: right});
        const dependencies = {
            a: inner('left', first), b: inner('right', second),
            c: inner('left-copy', {...first}),
            d: inner('bare-copy', {source: store, version: 0, reads: reads[0]}),
            e: inner('equal-path-distinct-set', {source: store, version: 0, reads: new Set(['a'])}),
        };
        const key = ':' + store.getUID();
        const versions: IDict<ILeafVersion> = {};
        captureLeafVersions(dependencies, versions);
        const output = versions[key];
        expect(output).not.toBe(first);
        expect(output.parts).toHaveLength(5);
        parts.forEach((part, index) => expect(output.parts![index]).toBe(part));
        expect(output.parts![4].reads).not.toBe(reads[0]);
        expect([...output.parts![4].reads]).toEqual(['a']);
        expect(first.parts).toBe(left);
        expect(second.parts).toBe(right);
        expect(left).toEqual(parts.slice(0, 2));
        expect(right).toEqual(parts.slice(1));
        reads.forEach((read, index) => expect([...read]).toEqual([fields[index]]));
    });

    test.each([8, 16, 32])('K=%s appends without revisiting an owned prefix or mutating borrowed parts', K => {
        const store = new Carburetor({a: 1});
        const constituents = Array.from({length: K}, (_, version) => ({version, reads: new Set(['p' + version])}));
        let visited = 0;
        const dependencies: IDict<IReadSet> = {};
        for (let i = 0; i < K; i += 2) {
            const borrowed = constituents.slice(i, i + 2);
            for (let j = 0; j < borrowed.length; j++) {
                const part = borrowed[j];
                Object.defineProperty(borrowed, j, {get: () => { visited++; return part; }});
            }
            Object.freeze(borrowed);
            dependencies['d' + i] = inner('group' + i, {source: store, version: i + 1, parts: borrowed});
        }
        const old: IDict<ILeafVersion> = {};
        const iterator = Array.prototype[Symbol.iterator];
        let references = 0;
        Array.prototype[Symbol.iterator] = function counted() {
            const underlying = iterator.call(this);
            const pairs = this.length > 0 && this[0]?.reads instanceof Set && !this[0]?.source;
            return {
                next: () => {
                    const item = underlying.next();
                    if (pairs && !item.done) references++;
                    return item;
                },
                [Symbol.iterator]() { return this; },
            };
        };
        try {
            const control = [...constituents];
            expect(control).toHaveLength(K);
            expect(references).toBe(K);
            references = 0;
            captureLeafVersions(dependencies, old);
        } finally {
            Array.prototype[Symbol.iterator] = iterator;
        }
        expect(references).toBeLessThanOrEqual(K);
        expect(visited).toBeLessThanOrEqual(2 * K);
        const oldParts = old[':' + store.getUID()].parts!;
        const current: IDict<ILeafVersion> = {};
        visited = 0;
        captureLeafVersions(dependencies, current);
        expect(visited).toBe(K);
        expect(current[':' + store.getUID()].parts).not.toBe(oldParts);
        expect(oldParts).toHaveLength(K);
        constituents.forEach((part, i) => {
            expect(oldParts[i]).toBe(part);
            expect(current[':' + store.getUID()].parts![i]).toBe(part);
        });
    });

    test.each([8, 16, 32])('observed flat K=%s captures shared-store fan-in with linear pair work', K => {
        const initial: Record<string, number> = {noise: 0};
        for (let i = 0; i < K; i++) initial['p' + i] = i + 1;
        const store = new Carburetor(initial);
        const runs = Array(K).fill(0);
        const leaves = Array.from({length: K}, (_, i) => computed(read => {
            runs[i]++;
            return read(store)['p' + i];
        }));
        let totalRuns = 0;
        const total = computed(read => {
            totalRuns++;
            return leaves.reduce((sum, leaf) => sum + read(leaf), 0);
        });
        const seen: number[] = [];
        const id = total.subscribe(() => seen.push(total.get()));
        try {
            const checksum = K * (K + 1) / 2;
            expect(total.get()).toBe(checksum);
            expect(runs).toEqual(Array(K).fill(1));
            expect(totalRuns).toBe(1);
            expect(seen).toEqual([]);
            const old = snapshot(total)[':' + store.getUID()];
            const oldParts = old.parts!.slice();
            expect(oldParts).toHaveLength(K);
            const oldReads = oldParts.map(part => [...part.reads]);
            const oldVersions = oldParts.map(part => part.version);
            store.update(draft => { draft.noise++; });
            expect(total.get()).toBe(checksum);
            expect(runs).toEqual(Array(K).fill(1));
            expect(totalRuns).toBe(1);
            expect(seen).toEqual([]);

            const iterator = Array.prototype[Symbol.iterator];
            const push = Array.prototype.push;
            const isPair = (value: unknown): boolean => value !== null && typeof value === 'object'
                && 'reads' in value && value.reads instanceof Set
                && 'version' in value && typeof value.version === 'number' && !('source' in value);
            let yields = 0;
            let appends = 0;
            let emptyYields = 0;
            let emptyAppends = 0;
            let copyYields = 0;
            let copyAppends = 0;
            let appendYields = 0;
            let appendAppends = 0;
            let result = 0;
            let repeated = 0;
            Array.prototype[Symbol.iterator] = function counted() {
                const underlying = iterator.call(this);
                return {
                    next: () => {
                        const item = underlying.next();
                        if (!item.done && isPair(item.value)) yields++;
                        return item;
                    },
                    [Symbol.iterator]() { return this; },
                };
            };
            Array.prototype.push = function counted(...items) {
                for (let i = 0; i < items.length; i++) {
                    if (isPair(items[i])) appends++;
                }
                return push.apply(this, items);
            };
            try {
                const empty: typeof oldParts = [];
                const emptyCopy = [...empty];
                emptyCopy.push();
                emptyYields = yields;
                emptyAppends = appends;
                yields = appends = 0;
                const copied = [...oldParts];
                copyYields = yields;
                copyAppends = appends;
                yields = appends = 0;
                const appended: typeof oldParts = [];
                appended.push.apply(appended, copied);
                appendYields = yields;
                appendAppends = appends;
                yields = appends = 0;
                store.update(draft => { draft.p0 += 100; });
                result = total.get();
                repeated = total.get();
            } finally {
                Array.prototype[Symbol.iterator] = iterator;
                Array.prototype.push = push;
            }
            expect([emptyYields, emptyAppends]).toEqual([0, 0]);
            expect([copyYields, copyAppends]).toEqual([K, 0]);
            expect([appendYields, appendAppends]).toEqual([0, K]);
            expect(yields + appends).toBeGreaterThanOrEqual(K);
            expect(yields + appends).toBeLessThanOrEqual(2 * K);
            expect(result).toBe(checksum + 100);
            expect(repeated).toBe(checksum + 100);
            expect(runs).toEqual(Array.from({length: K}, (_, i) => i === 0 ? 2 : 1));
            expect(totalRuns).toBe(2);
            expect(seen).toEqual([checksum + 100]);
            const current = snapshot(total)[':' + store.getUID()];
            expect(current.parts).toHaveLength(K);
            expect(current.parts).not.toBe(old.parts);
            expect(old.parts).toEqual(oldParts);
            oldParts.forEach((part, i) => {
                expect(old.parts![i]).toBe(part);
                expect(part.version).toBe(oldVersions[i]);
                expect([...part.reads]).toEqual(oldReads[i]);
            });
            store.update(draft => { draft.noise++; });
            expect(total.get()).toBe(checksum + 100);
            expect(runs).toEqual(Array.from({length: K}, (_, i) => i === 0 ? 2 : 1));
            expect(totalRuns).toBe(2);
            expect(seen).toEqual([checksum + 100]);
        } finally {
            total.unsubscribe(id);
        }
    });

    test('distinct sources publish a coherent transaction', () => {
        const stores = [new Carburetor({n: 1}), new Carburetor({n: 2})];
        const total = computed(read => read(stores[0]).n + read(stores[1]).n);
        const seen: number[] = [];
        const id = total.subscribe(() => seen.push(total.get()));
        try {
            transaction(() => {
                stores[0].update(draft => { draft.n = 3; });
                stores[1].update(draft => { draft.n = 4; });
                expect(total.get()).toBe(7);
                expect(seen).toEqual([]);
            });
            expect(seen).toEqual([7]);
        } finally {
            total.unsubscribe(id);
        }
    });
});

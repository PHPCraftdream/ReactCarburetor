import {Carburetor, computed, IComputed} from '@/Carburetor';
import {computedDependencies} from '@/Carburetor/Derived/computedDependencies';
import {captureLeafVersions} from '@/Carburetor/Derived/Freshness/captureLeafVersions';
import {ILeafVersion, IReadSet} from '@/Carburetor/Derived/Freshness/Models';
import {IDict} from '@/Carburetor/Models/Base';

const snapshot = (source: IReadSet['source']): IDict<ILeafVersion> =>
    computedDependencies.versions.get(source)!() as IDict<ILeafVersion>;
const foreign = (uid: string): IComputed<number> => ({
    getUID: () => uid, getVersion: () => 0, get: () => 1,
    subscribe: () => uid, unsubscribe: () => {},
});
const edge = (source: IReadSet['source']): IReadSet => ({source, reads: new Set(['*'])});

describe('R44-C01 conservative metadata boundaries', () => {
    test('arbitrary foreign keys normalize; foreign dictionaries are never borrowed or skipped', () => {
        const leaf = foreign('__proto__');
        const reads = new Set(['a']);
        const record: ILeafVersion = {source: leaf, version: 0, reads};
        const dictionary: IDict<ILeafVersion> = {constructor: record};
        const first = foreign('first'), second = foreign('second');
        computedDependencies.versions.set(first, () => dictionary);
        computedDependencies.versions.set(second, () => dictionary);
        try {
            const keys = Object.keys;
            let calls = 0;
            Object.keys = object => { if (object === dictionary) calls++; return keys(object); };
            let captured: ReturnType<typeof captureLeafVersions>;
            try { captured = captureLeafVersions({arbitrary: edge(first), ':spoof': edge(second)}); }
            finally { Object.keys = keys; }
            expect(calls).toBe(2);
            expect(Object.keys(captured.versions)).toEqual([':__proto__']);
            expect(captured.allNative).toBe(false);
            expect(captured.versions).not.toBe(dictionary);
            expect(dictionary.constructor).toBe(record);
            expect(record.parts).toBeUndefined();
            const single = captureLeafVersions({ignoredKey: edge(first)});
            expect(single.versions).not.toBe(dictionary);
            expect(Object.keys(single.versions)).toEqual([':__proto__']);
        } finally {
            computedDependencies.versions.delete(first);
            computedDependencies.versions.delete(second);
        }
    });

    test.each(['getVersion', 'emitUpdate'] as const)('native leaf protocol change %s loses epoch coverage', method => {
        const store = new Carburetor({n: 1});
        const group = computed(read => read(store).n);
        const alias = computed(read => read(group));
        expect(alias.get()).toBe(1);
        const old = snapshot(alias);
        const protocol = store as unknown as {getVersion: () => number; emitUpdate: () => void};
        const original = protocol[method];
        try {
            if (method === 'getVersion') protocol.getVersion = () => (original.call(store) as number) + 10;
            else protocol.emitUpdate = () => { original.call(store); };
            const captured = captureLeafVersions({alias: edge(alias)});
            expect(captured.allNative).toBe(false);
            expect(captured.versions[':' + store.getUID()].version).toBe(old[':' + store.getUID()].version);
            expect(old[':' + store.getUID()].version).toBe(0);
        } finally {
            if (method === 'getVersion') protocol.getVersion = original as () => number;
            else protocol.emitUpdate = original as () => void;
        }
    });

    test.each(['get', 'getVersion', 'registry'] as const)(
        'changed computed producer %s takes flattening fallback', method => {
        const store = new Carburetor({n: 1});
        const group = computed(read => read(store).n);
        expect(group.get()).toBe(1);
        const old = snapshot(group);
        const get = group.get, version = group.getVersion;
        const getter = computedDependencies.versions.get(group)!;
        try {
            if (method === 'get') group.get = () => get.call(group);
            if (method === 'getVersion') group.getVersion = () => version.call(group);
            if (method === 'registry') computedDependencies.versions.set(group, () => old);
            const keys = Object.keys;
            let visits = 0;
            Object.keys = object => {
                const result = keys(object);
                if (object === old) visits += result.length;
                return result;
            };
            try { captureLeafVersions({group: edge(group)}); }
            finally { Object.keys = keys; }
            expect(visits).toBe(1);
        } finally {
            group.get = get;
            group.getVersion = version;
            computedDependencies.versions.set(group, getter);
        }
    });

    test('external silent version remains a freshness source through native aliases', () => {
        let n = 1, version = 0;
        const external = foreign('silent');
        external.get = () => n;
        external.getVersion = () => version;
        const group = computed(read => read(external));
        const alias = computed(read => read(group) * 2);
        expect(alias.get()).toBe(2);
        n = 3; version++;
        expect(alias.get()).toBe(6);
        expect(alias.getVersion()).toBe(0);
        expect(Object.values(snapshot(alias))[0].version).toBe(1);
    });

    test('overlapping snapshots retain reads identity AND captured version, including last-record order', () => {
        const store = new Carburetor({a: 1, b: 2});
        const a = new Set(['a']), otherA = new Set(['a']), b = new Set(['b']);
        const records: ILeafVersion[] = [
            {source: store, version: 0, reads: a},
            {source: store, version: 1, parts: [{version: 1, reads: a}, {version: 1, reads: b}]},
            {source: store, version: 0, reads: otherA},
        ];
        const inputs = records.map((record, i) => {
            const source = foreign('overlap' + i);
            computedDependencies.versions.set(source, () => ({arbitrary: record}));
            return source;
        });
        try {
            const output = captureLeafVersions({a: edge(inputs[0]), b: edge(inputs[1]), c: edge(inputs[2]),
                again: edge(inputs[0])}).versions[':' + store.getUID()];
            expect(output.parts).toHaveLength(4);
            for (const [reads, version] of [[a, 0], [a, 1], [b, 1], [otherA, 0]] as const) {
                expect(output.parts!.filter(part => part.reads === reads && part.version === version)).toHaveLength(1);
            }
            expect(output.version).toBe(0);
            expect(records[0].parts).toBeUndefined();
            expect(records[1].parts).toHaveLength(2);
        } finally { inputs.forEach(source => computedDependencies.versions.delete(source)); }
    });

    test('alias branch migration retires old leaves and publishes only related writes', () => {
        const flag = new Carburetor({right: false});
        const left = new Carburetor({n: 1}), right = new Carburetor({n: 2});
        const l = computed(read => read(left).n), r = computed(read => read(right).n);
        const alias = computed(read => read(read(flag).right ? r : l));
        const top = computed(read => read(alias) * 2);
        const seen: number[] = [];
        const id = top.subscribe(() => seen.push(top.get()));
        try {
            expect(top.get()).toBe(2);
            flag.update(draft => { draft.right = true; });
            expect(top.get()).toBe(4);
            left.update(draft => { draft.n = 9; });
            expect(top.get()).toBe(4);
            right.update(draft => { draft.n = 3; });
            expect(top.get()).toBe(6);
            expect(seen).toEqual([4, 6]);
            expect(top.getVersion()).toBe(2);
            expect(snapshot(top)[':' + left.getUID()]).toBeUndefined();
            expect(snapshot(top)[':' + right.getUID()].version).toBe(right.getVersion());
        } finally { top.unsubscribe(id); }
    });
});

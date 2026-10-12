import {Carburetor, computed, ICarburetorSubscription, transaction} from '@/Carburetor';
import {Computed} from '@/Carburetor/Derived/Computed';
import {C} from '@/Carburetor/Derived/Models';
import {computedDependencies} from '@/Carburetor/Derived/computedDependencies';
import {CARBURETOR_SNAPSHOT_VERSION, IInternalSubscriptionProtocol} from '@/Carburetor/Store/Utils/Models';
import {updateWave} from '@/Carburetor/Store/Scheduling/UpdateWaveInstance';

const token = (source: ICarburetorSubscription): number =>
    (source as IInternalSubscriptionProtocol)[CARBURETOR_SNAPSHOT_VERSION]!();

const expectFailure = (read: () => unknown, failure: Error): void => {
    let caught: unknown;
    try { read(); } catch (error: unknown) { caught = error; }
    expect(caught).toBe(failure);
};

describe('R43-C03 observed equal checkpoint', () => {
    test.each([false, true])('alive equal migrations release retired metadata, projected=%s', projected => {
        const gate = new Carburetor({tick: 0});
        const sources = [1, 1, 1].map(n => new Carburetor({n}));
        let selected = sources[0];
        let runs = 0;
        const value = computed(read => {
            runs++;
            void read(gate).tick;
            const n = read(selected).n;
            return projected ? [n] : n;
        }, {equals: (before, after) => projected && (before as number[])[0] === (after as number[])[0]});
        const seen: (number | number[])[] = [];
        const id = value.subscribe(() => seen.push(value.get()));
        const baseline = value.get();
        const initialVersions = value[C.announced]!.versions;
        try {
            for (let index = 1; index < sources.length; index++) {
                const retired = selected;
                selected = sources[index];
                gate.update(draft => { draft.tick++; });
                expect(value.get()).toBe(baseline);
                const current = computedDependencies.versions.get(value)!();
                const announced = value[C.announced]!.versions;
                expect(Object.values(current).some(record => record.source === retired)).toBe(false);
                expect(Object.values(announced).some(record => record.source === retired)).toBe(false);
                expect(Object.values(current).some(record => record.source === selected)).toBe(true);
                expect(Object.values(announced).some(record => record.source === selected)).toBe(true);
                expect(value[C.announced]!.value).toBe(baseline);
                expect(token(value)).toBe(0);
                expect(value.getVersion()).toBe(0);
                expect(seen).toEqual([]);
                const settledRuns = runs;
                retired.update(draft => { draft.n = 9; });
                expect(value.get()).toBe(baseline);
                expect(runs).toBe(settledRuns);
            }
            expect(Object.values(initialVersions).some(record => record.source === sources[0])).toBe(true);
            expect(Object.values(initialVersions).some(record => record.source === selected)).toBe(false);
            selected.update(draft => { draft.n = 2; });
            expect(value.get()).toEqual(projected ? [2] : 2);
            expect(seen).toEqual(projected ? [[2]] : [2]);
            expect(value.getVersion()).toBe(1);
            expect(token(value)).toBe(1);
        } finally {
            value.unsubscribe(id);
        }
    });

    test.each([true, false])('eager migration keeps owed settlement checkpoint, equal=%s', equal => {
        const gate = new Carburetor({tick: 0});
        const left = new Carburetor({n: 1});
        const right = new Carburetor({n: equal ? 1 : 2});
        let selected = left;
        const value = computed(read => {
            void read(gate).tick;
            return read(selected).n;
        });
        const seen: number[] = [];
        const id = value.subscribe(() => seen.push(value.get()));
        try {
            const before = value[C.announced]!.versions;
            transaction(() => {
                selected = right;
                gate.update(draft => { draft.tick++; });
                expect(value.get()).toBe(equal ? 1 : 2);
                expect(Object.values(before).some(record => record.source === left)).toBe(true);
                expect(Object.values(value[C.versions]).some(record => record.source === right)).toBe(true);
                expect(seen).toEqual([]);
                expect(token(value)).toBe(0);
            });
            expect(Object.values(value[C.announced]!.versions).some(record => record.source === left)).toBe(false);
            expect(Object.values(value[C.announced]!.versions).some(record => record.source === right)).toBe(true);
            expect(seen).toEqual(equal ? [] : [2]);
            expect(value.getVersion()).toBe(equal ? 0 : 1);
            expect(token(value)).toBe(equal ? 0 : 1);
        } finally {
            value.unsubscribe(id);
        }
    });

    test.each(['body', 'comparator'])('failed %s settlement does not accept the checkpoint', lane => {
        const gate = new Carburetor({tick: 0});
        const left = new Carburetor({n: 1});
        const right = new Carburetor({n: 1});
        const failure = new Error('checkpoint failure');
        let selected = left;
        let poison = false;
        const value = computed(read => {
            void read(gate).tick;
            const n = read(selected).n;
            if (poison && lane === 'body') throw failure;
            return [n];
        }, {
            equals: (before, after) => {
                if (poison && lane === 'comparator') throw failure;
                return before[0] === after[0];
            },
        });
        const seen: number[][] = [];
        const id = value.subscribe(() => seen.push(value.get()));
        const baseline = value.get();
        const checkpoint = value[C.announced]!.versions;
        updateWave.begin();
        try {
            selected = right;
            poison = true;
            gate.update(draft => { draft.tick++; });
            expectFailure(() => value[C.settle](), failure);
            expectFailure(() => value[C.settle](), failure);
            expect(value[C.announced]!.value).toBe(baseline);
            expect(Object.values(checkpoint).some(record => record.source === left)).toBe(true);
            if (lane === 'comparator') {
                expect(Object.values(value[C.versions]).some(record => record.source === right)).toBe(true);
            }
            expect(token(value)).toBe(0);
            expect(value.getVersion()).toBe(0);
            expect(seen).toEqual([]);
        } finally {
            poison = false;
            updateWave.end();
            value.unsubscribe(id);
        }
    });

    test('abandoned queued settlement cannot checkpoint a replacement observation', () => {
        const gate = new Carburetor({tick: 0});
        const left = new Carburetor({n: 1});
        const right = new Carburetor({n: 1});
        let selected = left;
        const value = computed(read => {
            void read(gate).tick;
            return read(selected).n;
        });
        const seen: number[] = [];
        value.subscribe(() => seen.push(value.get()), {id: 'owner'});
        updateWave.begin();
        try {
            selected = right;
            gate.update(draft => { draft.tick++; });
            value.unsubscribe('owner');
            expect(value[C.announced]).toBeUndefined();
            value.subscribe(() => seen.push(value.get()), {id: 'owner'});
        } finally {
            updateWave.end();
        }
        try {
            expect(value.get()).toBe(1);
            const checkpoint = Object.values(value[C.announced]!.versions);
            expect(checkpoint.some(record => record.source === left)).toBe(false);
            expect(checkpoint.some(record => record.source === right)).toBe(true);
            expect(seen).toEqual([]);
            expect(value.getVersion()).toBe(0);
            expect(token(value)).toBe(0);
            right.update(draft => { draft.n = 2; });
            expect(seen).toEqual([2]);
            expect(value.getVersion()).toBe(1);
            expect(token(value)).toBe(1);
        } finally {
            value.unsubscribe('owner');
        }
    });

    test.each([false, true])('comparator closing observation cannot commit old generation, rejoin=%s', rejoin => {
        const gate = new Carburetor({tick: 0});
        const sources = [1, 2, 3].map(n => new Carburetor({n}));
        let selected = sources[0];
        let close = false;
        const seen: number[] = [];
        const onRejoinedValue = (): void => { seen.push(value.get()); };
        const compare = (): boolean => {
            if (!close) return false;
            close = false;
            value.unsubscribe('owner');
            selected = sources[2];
            if (rejoin) value.subscribe(onRejoinedValue, {id: 'owner'});
            return true;
        };
        const value: Computed<number> = computed(read => {
            void read(gate).tick;
            return read(selected).n;
        }, {equals: compare});
        value.subscribe(() => seen.push(value.get()), {id: 'owner'});
        try {
            selected = sources[1];
            close = true;
            gate.update(draft => { draft.tick++; });
            expect(seen).toEqual([]);
            expect(value.getVersion()).toBe(0);
            if (rejoin) {
                expect(value.get()).toBe(3);
                expect(value[C.announced]!.value).toBe(3);
                const sourcesInCheckpoint = Object.values(value[C.announced]!.versions).map(record => record.source);
                expect(sourcesInCheckpoint).toContain(sources[2]);
                expect(sourcesInCheckpoint).not.toContain(sources[0]);
                expect(sourcesInCheckpoint).not.toContain(sources[1]);
                const revision = token(value);
                sources[2].update(draft => { draft.n = 4; });
                expect(seen).toEqual([4]);
                expect(token(value)).toBe(revision + 1);
            } else {
                expect(value[C.announced]).toBeUndefined();
            }
        } finally {
            value.unsubscribe('owner');
        }
    });
});

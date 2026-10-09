import {S} from "@/Carburetor/Store/Diagnostics/Internal/StoreIdentity";
import {Carburetor} from '@/Carburetor';
import {
    CARBURETOR_PATHS_SINCE, CARBURETOR_TARGETS_SINCE, CARBURETOR_TRACK_TARGETS, IInternalSubscriptionProtocol,
} from '@/Carburetor/Store/Utils/Models';

export interface IData {tick: number; rows: Array<{a: number}>; other: {b: number}}

export class Store extends Carburetor<IData> {
    public change(fn: (draft: IData) => void): void { this.update(fn); }
}

export const makeStore = (): Store => new Store({tick: 0, rows: [{a: 0}], other: {b: 0}});

const protocol = (store: object): IInternalSubscriptionProtocol => store as unknown as IInternalSubscriptionProtocol;

/** The paths written after a version, or undefined when the store does not track. */
export const pathsSince = (store: object, version: number): ReadonlyArray<string> | undefined =>
    protocol(store)[CARBURETOR_PATHS_SINCE]?.call(store, version);

export const targetsSince = (store: object, version: number): ReadonlyMap<string, ReadonlySet<object>> | undefined =>
    protocol(store)[CARBURETOR_TARGETS_SINCE]?.call(store, version);

/** Registers one owner through the internal protocol and returns its release. */
export const acquire = (store: object): (() => void) =>
    protocol(store)[CARBURETOR_TRACK_TARGETS]!.call(store) as unknown as () => void;

interface IInternals {
    [S.writeLog]: {trackedSince: number; targets: {paths: Map<string, Set<object>>; count: number; cached: unknown};
        recent: {entries: Map<string, unknown>}};
    [S.writeTargets]: {enabled: boolean; pairs: unknown[]};
}

/** Private structures of a store, for retention probes. */
export const internals = (store: object): IInternals => store as unknown as IInternals;

/** Counts Map/Set constructions while `run` executes. */
export const countConstructors = (run: () => void): {maps: number; sets: number} => {
    const OriginalMap = globalThis.Map;
    const OriginalSet = globalThis.Set;
    const counts = {maps: 0, sets: 0};
    globalThis.Map = class extends OriginalMap {
        constructor(entries?: Iterable<readonly [unknown, unknown]> | null) { super(entries); counts.maps++; }
    } as MapConstructor;
    globalThis.Set = class extends OriginalSet {
        constructor(values?: Iterable<unknown> | null) { super(values); counts.sets++; }
    } as SetConstructor;
    try { run(); } finally { globalThis.Map = OriginalMap; globalThis.Set = OriginalSet; }
    return counts;
};

/** 1000 writes, nested or on the root scalar; returns constructor counts. */
export const thousandWrites = (store: Store, nested: boolean): {maps: number; sets: number} => {
    const before = store.getVersion();
    const counts = countConstructors(() => {
        for (let n = 1; n <= 1000; n++) {
            store.change(d => { if (nested) d.rows[0].a = n + before; else d.tick = n + before; });
        }
    });
    expect(store.getVersion()).toBe(before + 1000);
    return counts;
};

/** Wraps the store's paths-since probe and records each answer. */
export const spyPaths = (store: Store): Array<ReadonlyArray<string> | undefined> => {
    const answers: Array<ReadonlyArray<string> | undefined> = [];
    const original = protocol(store)[CARBURETOR_PATHS_SINCE]!;
    (store as unknown as Record<symbol, unknown>)[CARBURETOR_PATHS_SINCE] = (version: number) => {
        const answer = original.call(store, version);
        answers.push(answer);
        return answer;
    };
    return answers;
};

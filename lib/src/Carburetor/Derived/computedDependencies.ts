import {IDict, TSubscriber} from '@/Carburetor/Models/Base';
import {ICarburetorSubscription, ISubscribeOptions} from '@/Carburetor/Models/Store';
import {getUid} from '@/Carburetor/Store/Utils/getUid';
import {sharedSingleton} from '@/Carburetor/Store/Utils/sharedSingleton';
import {updateWave} from '@/Carburetor/Store/Scheduling/UpdateWaveInstance';
import {IDependency, IActiveReadSlot} from './Models';

/** Flattened native metadata shared across module copies. */
interface IVersion {
    /** Leaf source identity. */
    source: ICarburetorSubscription;
    /** Captured public version. */
    version: number;
}

/** One external upstream registration shared by dependent computations. */
interface IBridge {
    /** Upstream-owned registration id, distinct from dependent ids. */
    id: string;
    /** Dependent invalidation callbacks keyed by their own ids. */
    subscribers: Map<string, TSubscriber>;
}

// Object identity identifies native metadata across library copies.
const versions = sharedSingleton('computedVersions', () =>
    new WeakMap<ICarburetorSubscription, () => IDict<IVersion>>());
const bridges = sharedSingleton('computedExternalBridges', () =>
    new WeakMap<ICarburetorSubscription, IBridge>());

/** Native metadata lookup and ordered external subscription/recorder operations. */
export const computedDependencies = {
    versions,
    /** Subscribes native edges directly and shares one upstream bridge for external sources.
     *
     * @param source - dependency source.
     * @param callback - dependent invalidation callback.
     * @param options - dependent id and transferred reads.
     */
    subscribe(source: ICarburetorSubscription, callback: TSubscriber, options: ISubscribeOptions): void {
        if ('read' in source || versions.has(source)) {
            source.subscribe(callback, options);
            return;
        }

        const existing = bridges.get(source);
        if (existing) {
            existing.subscribers.set(options.id as string, callback);
            return;
        }

        // One upstream callback invalidates every dependent before the wave settles.
        const bridge: IBridge = {id: getUid(), subscribers: new Map([[options.id as string, callback]])};
        bridges.set(source, bridge);
        try {
            source.subscribe(() => {
                updateWave.begin();
                try {
                    for (const id of Array.from(bridge.subscribers.keys())) {
                        bridge.subscribers.get(id)?.();
                    }
                } finally {
                    updateWave.end();
                }
            }, {id: bridge.id});
        } catch (error: unknown) {
            bridges.delete(source);
            try { source.unsubscribe(bridge.id); } catch { /* Preserve the setup error. */ }
            throw error;
        }
    },
    /** Releases one dependent, closing an external bridge only after its last dependent leaves.
     *
     * @param source - dependency source.
     * @param id - dependent subscription identity, not the bridge's upstream identity.
     */
    unsubscribe(source: ICarburetorSubscription, id: string): void {
        if ('read' in source || versions.has(source)) {
            source.unsubscribe(id);
            return;
        }

        const bridge = bridges.get(source);
        if (!bridge) {
            return;
        }
        bridge.subscribers.delete(id);
        if (bridge.subscribers.size === 0) {
            bridges.delete(source);
            source.unsubscribe(bridge.id);
        }
    },
    /** Finds only an own dependency, even for hostile public source ids.
     *
     * @param record - encoded dependency dictionary.
     * @param id - encoded source identity.
     */
    ownDependency(record: IDict<IDependency>, id: string): IDependency | undefined {
        return Object.prototype.hasOwnProperty.call(record, id) ? record[id] : undefined;
    },
    /** Publishes only weakly filed source-identity slots; retires differing and absent routes.
     * Old views keep their slot, but no source or obsolete dependency after retirement.
     * The same selection restores published routes after speculative evaluation failure.
     *
     * @param dependencies - the published dependency set.
     * @param activeReads - per-source recorder slots, keyed by encoded source id.
     * @param readSlots - weak object-identity filing, preserved across release and rollback.
     */
    publishActiveReads(dependencies: IDict<IDependency>, activeReads: Map<string, IActiveReadSlot>,
        readSlots?: WeakMap<object, IActiveReadSlot>): void {
        for (const cuid of Object.keys(dependencies)) {
            const dependency = dependencies[cuid];
            const active = activeReads.get(cuid);
            const slot = readSlots?.get(dependency.source);
            if (active !== slot) {
                if (active) active.current = undefined;
                if (slot) activeReads.set(cuid, slot);
                else activeReads.delete(cuid);
            }
            if (slot) slot.current = dependency;
        }
        for (const cuid of activeReads.keys()) {
            if (!this.ownDependency(dependencies, cuid)) {
                const slot = activeReads.get(cuid);
                if (slot) slot.current = undefined;
                activeReads.delete(cuid);
            }
        }
    },
};

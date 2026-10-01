import {IDict, TSubscriber} from '@/Carburetor/Models/Base';
import {ICarburetorSubscription, ISubscribeOptions} from '@/Carburetor/Models/Store';
import {getUid} from '@/Carburetor/Store/Utils/getUid';
import {sharedSingleton} from '@/Carburetor/Store/Utils/sharedSingleton';
import {updateWave} from '@/Carburetor/Store/Scheduling/UpdateWaveInstance';
import {IDependency, IActiveReadSlot} from './Models';

interface IVersion {
    source: ICarburetorSubscription;
    version: number;
}

interface IBridge {
    id: string;
    subscribers: Map<string, TSubscriber>;
}

// Object identity identifies native metadata across library copies.
const versions = sharedSingleton('computedVersions', () =>
    new WeakMap<ICarburetorSubscription, () => IDict<IVersion>>());
const bridges = sharedSingleton('computedExternalBridges', () =>
    new WeakMap<ICarburetorSubscription, IBridge>());

export const computedDependencies = {
    versions,
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
    ownDependency(record: IDict<IDependency>, id: string): IDependency | undefined {
        return Object.prototype.hasOwnProperty.call(record, id) ? record[id] : undefined;
    },
    /** Points every persistent view's recorder at the published dependency of its source.
     *
     * @param dependencies - the published dependency set.
     * @param activeReads - per-source recorder slots, keyed by encoded source id.
     */
    publishActiveReads(dependencies: IDict<IDependency>, activeReads: Map<string, IActiveReadSlot>): void {
        for (const cuid of Object.keys(dependencies)) {
            const slot = activeReads.get(cuid);
            if (slot) {
                slot.current = dependencies[cuid];
            }
        }
        for (const cuid of activeReads.keys()) {
            if (!this.ownDependency(dependencies, cuid)) {
                activeReads.delete(cuid);
            }
        }
    },
};

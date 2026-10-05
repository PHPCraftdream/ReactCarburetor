import {ICarburetorSubscription} from '@/Carburetor/Models/Store';
import {CARBURETOR_SNAPSHOT_VERSION, IInternalSubscriptionProtocol} from '@/Carburetor/Store/Utils/Models';

/** The render-to-subscription token also covers changes before a native source is observed. */
export const getComputedSnapshotVersion = (source: ICarburetorSubscription): number => {
    const protocol = source as IInternalSubscriptionProtocol;

    // Called through the receiver: the symbol method reads instance state, so a detached call
    // would lose `this`.
    return typeof protocol[CARBURETOR_SNAPSHOT_VERSION] === 'function'
        ? protocol[CARBURETOR_SNAPSHOT_VERSION]() : source.getVersion();
};

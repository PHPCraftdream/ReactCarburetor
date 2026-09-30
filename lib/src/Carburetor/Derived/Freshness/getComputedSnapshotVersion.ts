import {ICarburetorSubscription} from '@/Carburetor/Models/Store';

/** The render-to-subscription token also covers changes before a native source is observed. */
export const getComputedSnapshotVersion = (source: ICarburetorSubscription): number =>
    'getSnapshotVersion' in source && typeof source.getSnapshotVersion === 'function'
        ? source.getSnapshotVersion() as number : source.getVersion();

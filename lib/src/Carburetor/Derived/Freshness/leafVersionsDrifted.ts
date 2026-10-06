import {IDict} from '@/Carburetor/Models/Base';
import {isNativeStoreSource} from '@/Carburetor/Store/Scheduling/isNativeStoreSource';
import {CARBURETOR_HAS_DRIFT, IInternalSubscriptionProtocol} from '@/Carburetor/Store/Utils/Models';
import {ILeafVersion, IReadSet} from './Models';
import {readStoreData} from './readStoreData';

/** Whether one moved leaf really concerns the paths it read; the store answers per filed pair.
 *
 * @param recorded - the leaf version snapshot to probe
 * @param dependency - fallback direct read set, used when the leaf filed no reads itself
 */
const leafDrifted = (recorded: ILeafVersion, dependency?: IReadSet): boolean => {
    if (!isNativeStoreSource(recorded.source)) {
        return true;
    }

    const probe = (recorded.source as IInternalSubscriptionProtocol)[CARBURETOR_HAS_DRIFT];
    if (!probe) {
        return true;
    }

    if (recorded.parts) {
        for (const part of recorded.parts) {
            if (probe.call(recorded.source, part.version, part.reads) !== false) {
                return true;
            }
        }

        return false;
    }

    const reads = recorded.reads ?? (dependency?.source === recorded.source ? dependency.reads : undefined);
    return !reads || probe.call(recorded.source, recorded.version, reads) !== false;
};

/** Checks leaf drift without allocating a key array.
 *
 * @param versions - the evaluation's leaf snapshot
 * @param dependencies - fallback direct read sets
 * @param liveResult - the value may hold views of a store's data: a replaced data object drifts it
 */
export const leafVersionsDrifted = (
    versions: IDict<ILeafVersion>, dependencies: IDict<IReadSet>, liveResult: boolean
): boolean => {
    for (const cuid in versions) {
        if (!Object.prototype.hasOwnProperty.call(versions, cuid)) {
            continue;
        }
        const recorded = versions[cuid];

        if (recorded.source.getVersion() !== recorded.version) {
            const dependency = Object.prototype.hasOwnProperty.call(dependencies, cuid)
                ? dependencies[cuid] : undefined;
            if (leafDrifted(recorded, dependency)
                || (liveResult && recorded.data !== undefined && readStoreData(recorded.source) !== recorded.data)) {
                return true;
            }
        }
    }

    return false;
};

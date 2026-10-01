import {IDict} from '@/Carburetor/Models/Base';
import {isNativeStoreSource} from '@/Carburetor/Store/Scheduling/isNativeStoreSource';
import {CARBURETOR_HAS_DRIFT, IInternalSubscriptionProtocol} from '@/Carburetor/Store/Utils/Models';
import {ILeafVersion, IReadSet} from './Models';

/** Checks leaf drift without allocating a key array.
 *
 * @param versions - the evaluation's leaf snapshot
 * @param dependencies - fallback direct read sets
 */
export const leafVersionsDrifted = (
    versions: IDict<ILeafVersion>, dependencies: IDict<IReadSet>
): boolean => {
    for (const cuid in versions) {
        if (!Object.prototype.hasOwnProperty.call(versions, cuid)) {
            continue;
        }
        const recorded = versions[cuid];

        if (recorded.source.getVersion() !== recorded.version) {
            const dependency = Object.prototype.hasOwnProperty.call(dependencies, cuid)
                ? dependencies[cuid] : undefined;
            const reads = recorded.reads ?? (dependency?.source === recorded.source
                ? dependency.reads : undefined);
            if (reads && isNativeStoreSource(recorded.source)
                && (recorded.source as IInternalSubscriptionProtocol)[CARBURETOR_HAS_DRIFT]?.(
                    recorded.version, reads) === false) {
                continue;
            }

            return true;
        }
    }

    return false;
};

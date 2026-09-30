import {IDict} from '@/Carburetor/Models/Base';
import {isNativeStoreSource} from '@/Carburetor/Store/Scheduling/isNativeStoreSource';
import {computedDependencies} from '@/Carburetor/Derived/computedDependencies';
import {ILeafVersion, IReadSet} from './Models';

/** Keep all paths read from a shared leaf without mutating an earlier announcement. */
const addLeafVersion = (versions: IDict<ILeafVersion>, id: string, recorded: ILeafVersion): void => {
    const previous = versions[id];
    if (previous?.source === recorded.source && previous.reads && recorded.reads
        && previous.reads !== recorded.reads) {
        const combined = new Set(previous.reads);
        for (const path of recorded.reads) {
            combined.add(path);
        }
        versions[id] = {source: recorded.source, version: recorded.version, reads: combined};
    } else {
        versions[id] = recorded;
    }
};

/** Fills a version snapshot and classifies native epoch coverage.
 *
 * @param dependencies - direct read sets to flatten
 * @param versions - destination leaf snapshot
 */
export const captureLeafVersions = (
    dependencies: IDict<IReadSet>, versions: IDict<ILeafVersion>
): boolean => {
    let allNative = true;

    for (const cuid of Object.keys(dependencies)) {
        const dependency = dependencies[cuid];
        const inner = 'read' in dependency.source
            ? undefined : computedDependencies.versions.get(dependency.source)?.() as IDict<ILeafVersion> | undefined;

        if (!inner) {
            addLeafVersion(versions, cuid, {
                source: dependency.source, version: dependency.source.getVersion(), reads: dependency.reads,
            });
            if (!isNativeStoreSource(dependency.source)) {
                allNative = false;
            }
            continue;
        }

        for (const key of Object.keys(inner)) {
            const recorded = inner[key];
            addLeafVersion(versions, ':' + recorded.source.getUID(), recorded);
            if (!isNativeStoreSource(recorded.source)) {
                allNative = false;
            }
        }
    }

    return allNative;
};

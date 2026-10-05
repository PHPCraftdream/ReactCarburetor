import {IDict} from '@/Carburetor/Models/Base';
import {isNativeStoreSource} from '@/Carburetor/Store/Scheduling/isNativeStoreSource';
import {computedDependencies} from '@/Carburetor/Derived/computedDependencies';
import {ILeafVersion, IReadSet} from './Models';

/** Fills a version snapshot and classifies native epoch coverage.
 *
 * @param dependencies - direct read sets to flatten
 * @param versions - destination leaf snapshot
 */
export const captureLeafVersions = (
    dependencies: IDict<IReadSet>, versions: IDict<ILeafVersion>
): boolean => {
    let allNative = true;
    // This capture's merged sets, one per shared leaf: created on the first merge, appended
    // after that, so a K-dependency fan-in costs O(K·M) insertions instead of O(K²·M).
    let combined: Map<string, Set<string>> | undefined;

    const addLeafVersion = (id: string, recorded: ILeafVersion): void => {
        const previous = versions[id];
        if (previous?.source === recorded.source && previous.reads && recorded.reads
            && previous.reads !== recorded.reads) {
            let merged = combined?.get(id);
            if (merged === undefined) {
                merged = new Set(previous.reads);
                (combined ??= new Map<string, Set<string>>()).set(id, merged);
            }
            for (const path of recorded.reads) {
                merged.add(path);
            }
            versions[id] = {source: recorded.source, version: recorded.version, reads: merged};
        } else {
            versions[id] = recorded;
        }
    };

    for (const cuid of Object.keys(dependencies)) {
        const dependency = dependencies[cuid];
        const inner = 'read' in dependency.source
            ? undefined : computedDependencies.versions.get(dependency.source)?.() as IDict<ILeafVersion> | undefined;

        if (!inner) {
            addLeafVersion(cuid, {
                source: dependency.source, version: dependency.source.getVersion(), reads: dependency.reads,
            });
            if (!isNativeStoreSource(dependency.source)) {
                allNative = false;
            }
            continue;
        }

        for (const key of Object.keys(inner)) {
            const recorded = inner[key];
            addLeafVersion(':' + recorded.source.getUID(), recorded);
            if (!isNativeStoreSource(recorded.source)) {
                allNative = false;
            }
        }
    }

    return allNative;
};

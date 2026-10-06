import {IDict} from '@/Carburetor/Models/Base';
import {isNativeStoreSource} from '@/Carburetor/Store/Scheduling/isNativeStoreSource';
import {computedDependencies} from '@/Carburetor/Derived/computedDependencies';
import {ILeafVersion, IReadSet} from './Models';
import {readStoreData} from './readStoreData';

/** Fills a version snapshot and classifies native epoch coverage. Merged leaves keep their
 * constituent filed pairs, so drift can be asked per part.
 *
 * @param dependencies - direct read sets to flatten
 * @param versions - destination leaf snapshot
 */
export const captureLeafVersions = (
    dependencies: IDict<IReadSet>, versions: IDict<ILeafVersion>
): boolean => {
    let allNative = true;

    const partsOf = (recorded: ILeafVersion): ReadonlyArray<{version: number; reads: ReadonlySet<string>}> =>
        recorded.parts ?? [{version: recorded.version, reads: recorded.reads as ReadonlySet<string>}];

    const addLeafVersion = (id: string, recorded: ILeafVersion): void => {
        const previous = versions[id];
        // A merged leaf (parts, no reads) must merge further: a later dependency fanning
        // into the same leaf, or a nested fan-in, would otherwise drop previous.parts.
        // reads may be undefined on either side; `undefined !== Set` still merges, and
        // identity-equal sets fall through to the else branch, which is correct.
        if (previous?.source === recorded.source
            && (previous.reads !== undefined || previous.parts !== undefined)
            && previous.reads !== recorded.reads) {
            versions[id] = {
                source: recorded.source, version: recorded.version, data: recorded.data,
                parts: [...partsOf(previous), ...partsOf(recorded)],
            };
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
                data: readStoreData(dependency.source),
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

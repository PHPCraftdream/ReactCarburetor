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

    let builders: IDict<{
        output: ILeafVersion;
        parts: Array<{version: number; reads: ReadonlySet<string>}>;
        membership: Map<ReadonlySet<string>, number | Set<number>>;
        firstMerged?: ILeafVersion;
        merged?: Set<ILeafVersion>;
    }> | undefined;

    const addLeafVersion = (id: string, recorded: ILeafVersion): void => {
        const previous = versions[id];
        if (previous === recorded) return;
        if (previous?.source === recorded.source
            && (previous.reads !== undefined || previous.parts !== undefined)
            && (recorded.reads !== undefined || recorded.parts !== undefined)
            && (previous.parts !== undefined || recorded.parts !== undefined
                || previous.reads !== recorded.reads || previous.version !== recorded.version)) {
            let builder = builders?.[id];
            const append = (part: {version: number; reads: ReadonlySet<string>}): void => {
                const captured = builder!.membership.get(part.reads);
                if (captured === undefined) {
                    builder!.membership.set(part.reads, part.version);
                } else if (typeof captured === 'number') {
                    if (captured === part.version) return;
                    builder!.membership.set(part.reads, new Set([captured, part.version]));
                } else {
                    if (captured.has(part.version)) return;
                    captured.add(part.version);
                }
                builder!.parts.push(part);
            };
            if (!builder) {
                const parts: Array<{version: number; reads: ReadonlySet<string>}> = [];
                builder = {
                    output: {source: recorded.source, version: recorded.version, data: recorded.data, parts},
                    parts,
                    membership: new Map(),
                    firstMerged: previous.parts !== undefined ? previous : undefined,
                };
                (builders ??= {})[id] = builder;
                if (previous.parts) {
                    for (const part of previous.parts) append(part);
                } else {
                    append({version: previous.version, reads: previous.reads as ReadonlySet<string>});
                }
                versions[id] = builder.output;
            }
            if (recorded.parts) {
                if (builder.firstMerged !== recorded && !builder.merged?.has(recorded)) {
                    for (const part of recorded.parts) append(part);
                    if (builder.firstMerged === undefined) {
                        builder.firstMerged = recorded;
                    } else {
                        if (builder.merged === undefined) {
                            builder.merged = new Set();
                            builder.merged.add(builder.firstMerged);
                        }
                        builder.merged.add(recorded);
                    }
                }
            } else {
                append({version: recorded.version, reads: recorded.reads as ReadonlySet<string>});
            }
            builder.output.version = recorded.version;
            builder.output.data = recorded.data;
        } else {
            if (builders) delete builders[id];
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

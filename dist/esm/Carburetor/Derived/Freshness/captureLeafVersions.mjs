import { isNativeStoreSource } from "../../Store/Scheduling/isNativeStoreSource.mjs";
import { computedDependencies } from "../computedDependencies.mjs";
const addLeafVersion = (versions, id, recorded)=>{
    const previous = versions[id];
    if ((null == previous ? void 0 : previous.source) === recorded.source && previous.reads && recorded.reads && previous.reads !== recorded.reads) {
        const combined = new Set(previous.reads);
        for (const path of recorded.reads)combined.add(path);
        versions[id] = {
            source: recorded.source,
            version: recorded.version,
            reads: combined
        };
    } else versions[id] = recorded;
};
const captureLeafVersions = (dependencies, versions)=>{
    let allNative = true;
    for (const cuid of Object.keys(dependencies)){
        var _computedDependencies_versions_get;
        const dependency = dependencies[cuid];
        const inner = 'read' in dependency.source ? void 0 : null == (_computedDependencies_versions_get = computedDependencies.versions.get(dependency.source)) ? void 0 : _computedDependencies_versions_get();
        if (!inner) {
            addLeafVersion(versions, cuid, {
                source: dependency.source,
                version: dependency.source.getVersion(),
                reads: dependency.reads
            });
            if (!isNativeStoreSource(dependency.source)) allNative = false;
            continue;
        }
        for (const key of Object.keys(inner)){
            const recorded = inner[key];
            addLeafVersion(versions, ':' + recorded.source.getUID(), recorded);
            if (!isNativeStoreSource(recorded.source)) allNative = false;
        }
    }
    return allNative;
};
export { captureLeafVersions };

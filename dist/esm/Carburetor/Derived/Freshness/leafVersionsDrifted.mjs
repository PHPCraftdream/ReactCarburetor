import { isNativeStoreSource } from "../../Store/Scheduling/isNativeStoreSource.mjs";
const leafVersionsDrifted = (versions, dependencies)=>{
    for(const cuid in versions){
        if (!Object.prototype.hasOwnProperty.call(versions, cuid)) continue;
        const recorded = versions[cuid];
        if (recorded.source.getVersion() !== recorded.version) {
            var _recorded_source_hasDriftSince, _recorded_source;
            const dependency = Object.prototype.hasOwnProperty.call(dependencies, cuid) ? dependencies[cuid] : void 0;
            const reads = recorded.reads ?? ((null == dependency ? void 0 : dependency.source) === recorded.source ? dependency.reads : void 0);
            if (reads && isNativeStoreSource(recorded.source) && (null == (_recorded_source_hasDriftSince = (_recorded_source = recorded.source).hasDriftSince) ? void 0 : _recorded_source_hasDriftSince.call(_recorded_source, recorded.version, reads)) === false) continue;
            return true;
        }
    }
    return false;
};
export { leafVersionsDrifted };

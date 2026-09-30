import { nativeStoreWriteEpoch } from "./nativeStoreWriteEpoch.mjs";
const isNativeStoreSource = (source)=>{
    const methods = nativeStoreWriteEpoch.sources.get(source);
    return void 0 !== methods && source.getVersion === methods.getVersion && source.emitUpdate === methods.emitUpdate;
};
export { isNativeStoreSource };

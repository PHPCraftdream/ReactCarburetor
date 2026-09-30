import { sharedSingleton } from "../Utils/sharedSingleton.mjs";
const nativeStoreWriteEpoch = sharedSingleton('nativeStoreWriteEpoch', ()=>({
        value: 0,
        sources: new WeakMap()
    }));
export { nativeStoreWriteEpoch };

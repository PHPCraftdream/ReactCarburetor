import { ConnectionFacadeHandler } from "./ConnectionFacadeHandler.mjs";
import { liveViews } from "../../Store/Tracking/liveViews.mjs";
import { WILDCARD_PATH } from "../../Store/Paths/WildcardPath.mjs";
const SHARED_OBJECT_TARGET = {};
const SHARED_ARRAY_TARGET = [];
const buildPersistentView = (source)=>{
    try {
        source.arrayFacade = Array.isArray(source.getCarburetor().getData());
    } catch (error) {
        source.probeError = error;
    }
    const facade = new Proxy(source.arrayFacade ? SHARED_ARRAY_TARGET : SHARED_OBJECT_TARGET, new ConnectionFacadeHandler(source));
    liveViews.noteDynamicReadTarget(facade, ()=>{
        const data = source.resolveAttemptSource().getData();
        const prototype = Object.getPrototypeOf(data);
        if (prototype === Array.prototype || prototype === Object.prototype || null === prototype) return data;
        if (data instanceof Map && prototype === Map.prototype || data instanceof Set && prototype === Set.prototype || data instanceof Date && prototype === Date.prototype) {
            source.recorder(WILDCARD_PATH);
            return data;
        }
    });
    return facade;
};
export { buildPersistentView };

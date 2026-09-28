import { ConnectionFacadeHandler } from "./ConnectionFacadeHandler.mjs";
import { IS_DEVELOPMENT } from "../../Store/Utils/DevelopmentFlag.mjs";
import { liveViews } from "../../Store/Tracking/liveViews.mjs";
const SHARED_OBJECT_TARGET = {};
const SHARED_ARRAY_TARGET = [];
const buildPersistentView = (source)=>{
    try {
        source.arrayFacade = Array.isArray(source.getCarburetor().getData());
    } catch (error) {
        source.probeError = error;
    }
    const facade = new Proxy(source.arrayFacade ? SHARED_ARRAY_TARGET : SHARED_OBJECT_TARGET, new ConnectionFacadeHandler(source));
    if (IS_DEVELOPMENT) liveViews.note(facade);
    return facade;
};
export { buildPersistentView };

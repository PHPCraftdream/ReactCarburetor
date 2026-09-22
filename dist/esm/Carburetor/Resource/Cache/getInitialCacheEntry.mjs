import { EResourceStatus } from "../../Models/Enums/EResourceStatus.mjs";
const getInitialCacheEntry = ()=>({
        status: EResourceStatus.Idle,
        data: void 0,
        error: void 0,
        updatedAt: void 0,
        refreshing: false,
        invalidated: false,
        failed: false
    });
export { getInitialCacheEntry };

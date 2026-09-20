import { EResourceStatus } from "../Models/Enums/EResourceStatus.mjs";
const getInitialResourceData = ()=>({
        status: EResourceStatus.Idle,
        data: void 0,
        error: void 0,
        updatedAt: void 0
    });
export { getInitialResourceData };

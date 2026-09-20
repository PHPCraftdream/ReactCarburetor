import { getUid } from "../Store/getUid.mjs";
const carburetorToken = (create)=>({
        id: getUid(),
        create
    });
export { carburetorToken };

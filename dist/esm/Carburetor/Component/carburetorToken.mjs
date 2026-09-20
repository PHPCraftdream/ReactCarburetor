import { getUid } from "../Store/Utils/getUid.mjs";
const carburetorToken = (create)=>({
        id: getUid(),
        create
    });
export { carburetorToken };

import { sharedSingleton } from "./sharedSingleton.mjs";
const counter = sharedSingleton('uidCounter', ()=>({
        next: 0
    }));
const getUid = ()=>{
    counter.next++;
    return 'carburetor-uid-' + counter.next;
};
export { getUid };

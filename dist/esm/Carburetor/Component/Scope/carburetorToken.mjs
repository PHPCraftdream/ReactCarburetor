import { diagnostics } from "../../Store/Diagnostics/DiagnosticsInstance.mjs";
import { IS_DEVELOPMENT } from "../../Store/Utils/DevelopmentFlag.mjs";
import { sharedSingleton } from "../../Store/Utils/sharedSingleton.mjs";
const takenNames = sharedSingleton('takenNames', ()=>new Set());
const carburetorToken = (create, name)=>{
    if ('' === name) throw new Error('Carburetor: a token needs a non-empty name: it is the key the client hydrates from.');
    if (takenNames.has(name)) {
        if (IS_DEVELOPMENT) diagnostics.report('a token named "' + name + '" already exists. Two tokens under one name would overwrite each other in a scope and in a dehydrate() payload; give one of them its own name — or ignore this if it is an HMR reload of the module that declared it.');
        return {
            id: name,
            create
        };
    }
    takenNames.add(name);
    return {
        id: name,
        create
    };
};
export { carburetorToken };

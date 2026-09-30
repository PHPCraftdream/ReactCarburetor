import { sharedSingleton } from "../Utils/sharedSingleton.mjs";
import { UpdateWave } from "./UpdateWave.mjs";
const updateWave = sharedSingleton('updateWave', ()=>new UpdateWave());
export { updateWave };

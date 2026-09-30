import { sharedSingleton } from "../Utils/sharedSingleton.mjs";
import { UpdateBatch } from "./UpdateBatch.mjs";
const updateBatch = sharedSingleton('updateBatch', ()=>new UpdateBatch());
export { updateBatch };

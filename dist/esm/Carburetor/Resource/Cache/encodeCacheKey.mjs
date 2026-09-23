import { escapeCacheKey } from "./escapeCacheKey.mjs";
const encodeCacheKey = (args)=>escapeCacheKey(JSON.stringify(void 0 === args ? null : args));
export { encodeCacheKey };

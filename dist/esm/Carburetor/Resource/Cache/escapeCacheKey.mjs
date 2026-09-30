import { PATH_SEPARATOR } from "../../Store/Paths/PathSeparator.mjs";
const escapeCacheKey = (json)=>json.includes('~') || json.includes(PATH_SEPARATOR) ? json.split('~').join('~0').split(PATH_SEPARATOR).join('~1') : json;
export { escapeCacheKey };

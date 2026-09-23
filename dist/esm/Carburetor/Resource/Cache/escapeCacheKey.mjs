import { PATH_SEPARATOR } from "../../Store/Paths/PathSeparator.mjs";
const escapeCacheKey = (json)=>json.split('~').join('~0').split(PATH_SEPARATOR).join('~1');
export { escapeCacheKey };

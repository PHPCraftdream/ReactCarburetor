import { PATH_SEPARATOR } from "./PathSeparator.mjs";
import { WILDCARD_PATH } from "./WildcardPath.mjs";
const pathsTouch = (readPath, writePath)=>readPath === writePath || readPath.startsWith(writePath + PATH_SEPARATOR) || writePath.startsWith(readPath + PATH_SEPARATOR);
const pathsIntersect = (reads, writes)=>{
    if (reads.has(WILDCARD_PATH) || writes.has(WILDCARD_PATH)) return true;
    for (const writePath of writes)for (const readPath of reads)if (pathsTouch(readPath, writePath)) return true;
    return false;
};
export { pathsIntersect };

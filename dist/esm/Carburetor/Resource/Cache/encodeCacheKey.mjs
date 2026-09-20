import { PATH_SEPARATOR } from "../../Store/Paths/PathSeparator.mjs";
const encodeCacheKey = (args)=>{
    const serialized = JSON.stringify(void 0 === args ? null : args);
    return serialized.split('~').join('~0').split(PATH_SEPARATOR).join('~1');
};
export { encodeCacheKey };

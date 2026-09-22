import { PATH_SEPARATOR } from "./PathSeparator.mjs";
const joinPath = (basePath, key)=>{
    const escaped = key.includes('~') || key.includes(PATH_SEPARATOR) ? key.split('~').join('~0').split(PATH_SEPARATOR).join('~1') : key;
    return basePath ? basePath + PATH_SEPARATOR + escaped : escaped;
};
export { joinPath };

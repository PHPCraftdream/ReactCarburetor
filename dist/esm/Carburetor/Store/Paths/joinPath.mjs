import { PATH_SEPARATOR } from "./PathSeparator.mjs";
const joinPath = (basePath, key)=>basePath ? basePath + PATH_SEPARATOR + key : key;
export { joinPath };

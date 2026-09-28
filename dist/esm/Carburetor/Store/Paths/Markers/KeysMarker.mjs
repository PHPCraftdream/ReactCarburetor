import { PATH_SEPARATOR } from "../PathSeparator.mjs";
const KEYS_MARKER = '~k';
const keysPath = (path)=>path ? path + PATH_SEPARATOR + KEYS_MARKER : KEYS_MARKER;
export { keysPath };

import { PATH_SEPARATOR } from "./PathSeparator.mjs";
const BRANCH_MARKER = '~p';
const branchPath = (path)=>path + PATH_SEPARATOR + BRANCH_MARKER;
export { branchPath };

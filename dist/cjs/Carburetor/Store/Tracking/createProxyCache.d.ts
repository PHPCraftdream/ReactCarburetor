import { TPath } from "../../Models/Paths.js";
/**
 * Cache of proxies for nested branches. It also remembers the source object: if the value
 * behind a path has been replaced, the proxy over the old object is no longer valid and
 * gets recreated.
 */
export declare const createProxyCache: () => (path: TPath, source: object, create: () => object) => object;

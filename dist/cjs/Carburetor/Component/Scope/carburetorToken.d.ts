import { ICarburetorToken } from "../../Models/Tooling.js";
/** A key a scope creates one instance per, carrying the factory that makes it. */
export declare const carburetorToken: <T extends unknown>(create: () => T) => ICarburetorToken<T>;

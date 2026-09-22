import { ICarburetorToken } from "../../Models/Tooling.js";
/**
 * Names a carburetor: a scope creates one instance per name, carrying the factory that builds it.
 *
 * The name is the token's `id`, and it crosses process boundaries: `CarburetorScope.dehydrate()`
 * keys its payload by it on the server and `hydrate()` matches on it on the client, in two
 * processes whose module graphs run independently. A sequential counter cannot provide that
 * match — any carburetor, component or token created before this one in one bundle but not the
 * other shifts every later id, and the client silently hydrates from defaults — so the caller
 * writes the name literally at both declaration sites and the two sides agree by construction.
 */
export declare const carburetorToken: <T extends unknown>(create: () => T, name: string) => ICarburetorToken<T>;

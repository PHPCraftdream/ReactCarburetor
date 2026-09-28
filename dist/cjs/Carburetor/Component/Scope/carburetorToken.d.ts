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
 *
 * A name already claimed is reported in development rather than thrown: a module re-evaluating
 * under HMR calls this again with the same name and a fresh `create` closure, and throwing would
 * turn every edit into a crash instead of a warning. The token returned still carries `create`
 * as given, so a scope that has not instantiated this id yet picks up the reloaded factory; one
 * that already has keeps its existing instance, since `CarburetorScope.get` looks up by `id`.
 *
 * @param create - the factory for the instance; run lazily, once per scope, on the token's
 * first `get` rather than at declaration time
 * @param name - the token's `id` and the dehydrate/hydrate key; must be non-empty, and unique
 * in this process outside of HMR reloads, and is written literally at both declaration sites
 */
export declare const carburetorToken: <T extends unknown>(create: () => T, name: string) => ICarburetorToken<T>;

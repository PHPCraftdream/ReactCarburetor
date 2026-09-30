import {ICarburetorToken} from "@/Carburetor/Models/Tooling";
import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";
import {IS_DEVELOPMENT} from "@/Carburetor/Store/Utils/DevelopmentFlag";
import {sharedSingleton} from "@/Carburetor/Store/Utils/sharedSingleton";

/** Names already claimed in this process, across library copies (see sharedSingleton). */
const takenNames: Set<string> = sharedSingleton('takenNames', () => new Set<string>());

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
export const carburetorToken = <T extends unknown>(create: () => T, name: string): ICarburetorToken<T> => {
    if (name === '') {
        throw new Error('Carburetor: a token needs a non-empty name: it is the key the client hydrates from.');
    }

    if (takenNames.has(name)) {
        if (IS_DEVELOPMENT) {
            diagnostics.report(
                'a token named "' + name + '" already exists. Two tokens under one name would ' +
                'overwrite each other in a scope and in a dehydrate() payload; give one of them its ' +
                'own name — or ignore this if it is an HMR reload of the module that declared it.'
            );
        }

        return {id: name, create};
    }

    takenNames.add(name);

    return {id: name, create};
};

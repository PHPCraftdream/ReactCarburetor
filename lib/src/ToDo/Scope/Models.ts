import {CarburetorScope, TDisposer} from "@/Carburetor";

export interface ITodoScope {
    scope: CarburetorScope;
    /** Stops everything the scope wired up outside React. */
    dispose: TDisposer;
}

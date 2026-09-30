import { ICarburetorSubscription } from "../Models/Store.mjs";
/**
 * Internal types of the derived layer: kept out of the public `Models/` barrel on purpose.
 */
/**
 * What a computed's live-read diagnostic needs to know about the component whose render is
 * currently on the stack; see `Derived/renderOwner.ts`.
 */
export interface IRenderOwner {
    /** The id this component would subscribe to a computed under. */
    uid: string;
    /**
     * Whether `source` is already tracked as a dependency of this render attempt — a
     * `useComputed(source)` call earlier in the same render body.
     *
     * @param source - the computed to check for
     */
    hasTracked: (source: ICarburetorSubscription) => boolean;
}

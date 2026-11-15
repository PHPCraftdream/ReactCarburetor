import {TPath} from "../../Models/Paths";
import {ICarburetorSubscription} from "../../Models/Store";
import {IDependencySlot} from "./Connection";

/**
 * Whether a slot still holds one resource entry of a source: registered with the stores,
 * committed, and committed with that entry among the ones its commit read.
 *
 * A deferred load runs after the commit and may be re-entered by user code at every step, so
 * each step asks this again before it acts on what it found earlier.
 *
 * @param slot - The component's dependency slot for the source.
 * @param source - The cache entry's owner the slot was filed for.
 * @param path - The canonical resource entry the load concerns.
 */
export const holdsResource = (
    slot: IDependencySlot,
    source: ICarburetorSubscription,
    path: TPath,
): boolean => slot.installed?.carburetor === source
    && slot.committed?.carburetor === source
    && slot.committed.resourcePaths?.has(path) === true;

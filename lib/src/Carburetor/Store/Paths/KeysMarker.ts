import {TPath} from "@/Carburetor/Models/Paths";
import {PATH_SEPARATOR} from "./PathSeparator";

/** The synthetic key standing in for "the key set itself was read", distinct from any leaf. */
const KEYS_MARKER = '~k';

/**
 * The path an enumeration (`Object.keys`/`values`/`entries`, `for…in`, spread,
 * `JSON.stringify`) subscribes by: reading the shape, not any value.
 *
 * Recording the container's own path would subscribe to every leaf below it; recording the
 * wildcard at the root would subscribe to everything in the store. Neither answers what
 * actually changed a key set.
 *
 * The marker is an ordinary segment below the container, so a write at or above the container
 * still wakes its enumerators through the usual ancestor matching — replacing `items` outright
 * still wakes whoever enumerated `items` — while a value write strictly below an existing key
 * does not. `~k` cannot collide with real data for the same reason `~p` cannot: joinPath escapes
 * `~` to `~0`, so no escaped key can contain a bare `~` followed by a letter.
 *
 * @param path - the container's own path; the root's empty path produces the bare marker.
 */
export const keysPath = (path: TPath): TPath => {
    return path ? path + PATH_SEPARATOR + KEYS_MARKER : KEYS_MARKER;
};

import {escapeCacheKey} from "@/Carburetor/Resource/Cache/escapeCacheKey";
import {checkResourceKeyValue} from "./checkResourceKeyValue";

/**
 * Encodes a custom key result the way the default key encodes one primitive: JSON.stringify
 * first, then the path-segment escape. The quoting keeps prototype-colliding keys readable
 * and distinct, so the number `5` encodes as `5`, while the string `'5'` encodes as `"5"`.
 *
 * The quoting is what keeps `'toString'`, `'__proto__'` and `''` from landing in the entries
 * dictionary as raw, prototype-colliding keys.
 */
export const encodeResourceKeyValue = (value: unknown): string => {
    // Validation only: checkResourceKeyValue stringifies numbers, which would erase the
    // 5/'5' distinction, so the number encodes through its own string form here.
    const key = checkResourceKeyValue(value);
    return escapeCacheKey(typeof value === 'number' ? key : JSON.stringify(key));
};

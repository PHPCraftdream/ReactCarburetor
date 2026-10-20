type TRecord = Record<string, unknown>;

/** The envelope's version key; a stored root is an envelope only with exactly this key and `data`. */
const VERSION_KEY = '__carburetorVersion';

/** Decodes legacy raw data or a version envelope and applies each intervening migration.
 *
 * @param parsed - parsed storage value
 * @param version - current schema version
 * @param migrate - validated synchronous migration chain
 */
export const readVersioned = (
    parsed: unknown,
    version: number,
    migrate: Record<number, (state: unknown) => unknown>
): {data: unknown; storedVersion: number} => {
    const record = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as TRecord : undefined;
    const keys = record === undefined ? [] : Object.keys(record);
    const envelope = keys.length === 2 && keys.includes(VERSION_KEY) && keys.includes('data');
    const found = envelope ? record?.[VERSION_KEY] : 0;
    if (!Number.isInteger(found) || (found as number) < 0) {
        throw new Error('persist: invalid stored version');
    }
    if ((found as number) > version) throw new Error('persist: stored version is newer than configured version');
    let data = envelope ? record?.data : parsed;
    for (let step = (found as number) + 1; step <= version; step++) data = migrate[step](data);
    return {data, storedVersion: found as number};
};

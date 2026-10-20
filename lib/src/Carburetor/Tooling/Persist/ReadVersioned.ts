type TRecord = Record<string, unknown>;

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
    const envelope = record !== undefined && Object.prototype.hasOwnProperty.call(record, 'v')
        && Object.prototype.hasOwnProperty.call(record, 'data');
    const found = envelope ? record?.v : 0;
    if (!Number.isInteger(found) || (found as number) < 0) {
        throw new Error('persist: invalid stored version');
    }
    if ((found as number) > version) throw new Error('persist: stored version is newer than configured version');
    let data = envelope ? record?.data : parsed;
    for (let step = (found as number) + 1; step <= version; step++) data = migrate[step](data);
    return {data, storedVersion: found as number};
};

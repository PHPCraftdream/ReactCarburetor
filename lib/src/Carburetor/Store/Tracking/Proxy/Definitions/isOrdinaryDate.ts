/** Exact intrinsic Date instances without own properties retain ordinary raw Date identity.
 *
 * @param value - the candidate value.
 */
export const isOrdinaryDate = (value: object): value is Date => {
    try {
        if (Object.getPrototypeOf(value) !== Date.prototype || Reflect.ownKeys(value).length !== 0) return false;
        Date.prototype.getTime.call(value);
        return true;
    } catch {
        return false;
    }
};

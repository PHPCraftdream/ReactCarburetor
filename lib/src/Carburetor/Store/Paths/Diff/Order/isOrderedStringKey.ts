/** Non-index string keys enumerate by insertion position, not numeric value.
 *
 * @param key - an own string property name.
 */
export const isOrderedStringKey = (key: string): boolean => {
    const index = Number(key);
    return !Number.isInteger(index) || index < 0 || index >= 0xFFFFFFFF || String(index) !== key;
};

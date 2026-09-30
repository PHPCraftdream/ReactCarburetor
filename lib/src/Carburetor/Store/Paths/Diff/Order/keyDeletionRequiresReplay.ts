import {isOrderedStringKey} from './isOrderedStringKey';

/** Whether undo would append a deleted key after an existing ordered string key.
 *
 * @param source - the container before deletion.
 * @param key - the own key being removed.
 */
export const keyDeletionRequiresReplay = (source: object, key: string): boolean => {
    if (!isOrderedStringKey(key)) return false;
    const keys = Object.keys(source);
    const position = keys.indexOf(key);
    for (let index = position + 1; position > -1 && index < keys.length; index++) {
        if (isOrderedStringKey(keys[index])) return true;
    }
    return false;
};

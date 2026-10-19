import {isOrderedStringKey} from './isOrderedStringKey';

/** One container's enumeration snapshot, updated incrementally by proxy deletes. */
interface ITailMemo {
    keys: string[];
    positions: Map<string, number>;
    lastOrdered: string | undefined;
    deleted: Set<string>;
}

const memos = new WeakMap<object, ITailMemo>();

const build = (source: object): ITailMemo => {
    const keys = Object.keys(source);
    const positions = new Map<string, number>();
    let lastOrdered: string | undefined;
    for (let index = keys.length - 1; index >= 0; index--) {
        positions.set(keys[index], index);
        if (lastOrdered === undefined && isOrderedStringKey(keys[index])) lastOrdered = keys[index];
    }
    const memo = {keys, positions, lastOrdered, deleted: new Set<string>()};
    memos.set(source, memo);
    return memo;
};

/** Forgets a container's snapshot after a proxy trap grew its key set back. */
const forget = (source: object): void => {
    memos.delete(source);
};

/**
 * Whether an ordered string key still enumerates after `key`, so undo would append the deleted
 * key out of order and the deletion must carry the replay marker.
 *
 * Amortized O(1) per delete: the enumeration is snapshotted once per container and updated
 * incrementally — deleting a non-last ordered key changes no earlier answer, and deleting the
 * last one walks the snapshot back past deleted entries. Proxies answer every tracked
 * container mutation, and any key-set growth rebuilds the snapshot.
 *
 * @param source - the container before deletion.
 * @param key - the own ordered string key being removed.
 */
const follows = (source: object, key: string): boolean => {
    if (!isOrderedStringKey(key)) return false;
    const memo = memos.get(source) ?? build(source);
    const position = memo.positions.get(key);
    if (position === undefined) return follows(build(source), key);
    if (memo.lastOrdered === undefined) return false;
    memo.deleted.add(key);
    if (memo.lastOrdered === key) {
        // Nothing ordered enumerates after the last ordered key; walk the snapshot back so the
        // next delete sees the survivor below it.
        let index = position - 1;
        while (index >= 0 && (!isOrderedStringKey(memo.keys[index]) || memo.deleted.has(memo.keys[index]))) index--;
        memo.lastOrdered = index >= 0 ? memo.keys[index] : undefined;
        return false;
    }
    return true;
};

/** The delete-order probe and its invalidation hook, one module export. */
export const orderedTailMemo = {follows, forget};

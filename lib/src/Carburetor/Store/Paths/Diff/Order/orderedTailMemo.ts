import {isOrderedStringKey} from './isOrderedStringKey';

/** One container's enumeration snapshot, updated incrementally by proxy deletes. */
interface ITailMemo {
    keys: string[];
    positions: Map<string, number>;
    lastOrdered: string | undefined;
    deleted: Set<string>;
    epoch: number;
}

const memos = new WeakMap<object, ITailMemo>();

/** Bumped when a publication closes: raw writes between publications cannot be tracked. */
let epoch = 0;

/**
 * Snapshots a container's enumeration for the current epoch.
 *
 * @param source - the container whose own enumerable keys are listed.
 */
const build = (source: object): ITailMemo => {
    const keys = Object.keys(source);
    const positions = new Map<string, number>();
    let lastOrdered: string | undefined;
    for (let index = keys.length - 1; index >= 0; index--) {
        positions.set(keys[index], index);
        if (lastOrdered === undefined && isOrderedStringKey(keys[index])) lastOrdered = keys[index];
    }
    const memo = {keys, positions, lastOrdered, deleted: new Set<string>(), epoch};
    memos.set(source, memo);
    return memo;
};

/** Forgets a container's snapshot after a proxy trap grew its key set or a delete was refused. */
const forget = (source: object): void => {
    memos.delete(source);
};

/** Starts a new epoch: every snapshot taken before is rebuilt on its next use. */
const advance = (): void => {
    epoch++;
};

/**
 * Whether an ordered string key still enumerates after `key`, so undo would append the deleted
 * key out of order and the deletion must carry the replay marker. Read-only: the snapshot
 * changes only through `removed`, after the delete went through.
 *
 * Amortized O(1) per delete: the enumeration is snapshotted once per container and epoch. A key
 * the snapshot has never seen (added behind the proxies' back) rebuilds it; a key that still
 * is not listed (not enumerable) answers conservatively with the marker.
 *
 * @param source - the container before deletion.
 * @param key - the own string key being removed.
 */
const follows = (source: object, key: string): boolean => {
    if (!isOrderedStringKey(key)) return false;
    let memo = memos.get(source);
    if (memo === undefined || memo.epoch !== epoch || !memo.positions.has(key)) memo = build(source);
    if (!memo.positions.has(key)) return true;
    return memo.lastOrdered !== undefined && memo.lastOrdered !== key;
};

/**
 * Records a delete that went through: the key leaves the snapshot, and deleting the last
 * ordered key walks the snapshot back past deleted entries to the survivor below it.
 *
 * @param source - the container the key was removed from.
 * @param key - the own string key that was removed.
 */
const removed = (source: object, key: string): void => {
    const memo = memos.get(source);
    const position = memo?.positions.get(key);
    if (memo === undefined || memo.epoch !== epoch || position === undefined) return;
    memo.deleted.add(key);
    if (memo.lastOrdered !== key) return;
    let index = position - 1;
    while (index >= 0 && (!isOrderedStringKey(memo.keys[index]) || memo.deleted.has(memo.keys[index]))) index--;
    memo.lastOrdered = index >= 0 ? memo.keys[index] : undefined;
};

/** The delete-order probe and its bookkeeping hooks, one module export. */
export const orderedTailMemo = {follows, removed, forget, advance};

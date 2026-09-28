/** Path to a data field, e.g. `items.workTodo1.title`. */
export type TPath = string;
export type TPathSet = Set<TPath>;
/** Records a path that has been read or written. */
export type TPathRecorder = (path: TPath) => void;
/**
 * Where each branch object was last seen by the read proxy, for the development alias report:
 * tracking is keyed by path, so an object reachable under two paths cannot be tracked.
 * `undefined` outside development. See createAliasLedger for the behaviour.
 */
export type TAliasLedger = {
    /** Records where a branch object was read, complaining when that is a second path. */
    note: (value: object, path: TPath) => void;
    /** Complains when a write lands in an object that was read under a different path. */
    checkWrite: (source: object, path: TPath) => void;
    /** Drops the recorded path of a value draft replaced or deleted. */
    forget: (value: unknown) => void;
} | undefined;
/**
 * Stands in for a patch endpoint that does not exist: an added key's `previous`, or a deleted
 * key's `next` — so a history entry can tell "assign undefined" from "the key was never there"
 * and undo an added key by deleting it, not by writing `undefined` back (R16-07).
 */
export declare const PATCH_ABSENT: unique symbol;
/**
 * Reported to a patch listener instead of a patch when a write cannot be described precisely:
 * the wildcard, an untrackable root, a symbol key, a whole-root replacement, or a write that
 * bypassed draft (R16-07). A listener that sees this for any write in a change has no patches
 * to invert for it and falls back to a full snapshot.
 */
export declare const PATCH_OPAQUE: unique symbol;
/**
 * One write the proxy could describe precisely, enough to invert it without a diff:
 * `segments` are the raw, unescaped keys from the store root to the written field — cheap to
 * replay onto a plain object or a draft, unlike `path`, whose escaping has no declared inverse.
 */
export interface IWritePatch {
    /** The keys from the store root to the written field, in order. */
    segments: readonly string[];
    /** The value before the write, or PATCH_ABSENT when the key was not yet its own. */
    previous: unknown;
    /** The value after the write, or PATCH_ABSENT when the write deleted the key. */
    next: unknown;
}
/** Delivers one patch per describable write, or PATCH_OPAQUE for one the proxy cannot describe. */
export type TPatchRecorder = (patch: IWritePatch | typeof PATCH_OPAQUE) => void;
/**
 * Where a store keeps the patch listener currently attached to it, if any: a write proxy holds
 * one of these per tree (not per branch), so attaching or detaching a listener needs no rebuild
 * — every handler already sharing the port sees the change on its next write.
 */
export type TPatchPort = {
    listener?: TPatchRecorder;
};

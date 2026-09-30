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
    /**
     * Throws if `value`'s subtree is not valid state (own symbol key, accessor, non-enumerable
     * property, or a non-index/`length` array key); a sub-branch `Object.is`-equal to the same
     * position in `previous` is skipped, unchecked.
     */
    checkState: (value: unknown, path: TPath, previous?: unknown) => void;
    /** Throws if `key` is not a valid array key (an index, or `length`) when `container` is an array. */
    checkKey: (container: object, key: string, path: TPath) => void;
} | undefined;

/**
 * Reported to a patch listener instead of a patch when a write cannot be described precisely:
 * the wildcard, an untrackable root, a whole-root replacement, or a write that bypassed draft
 * (R16-07). A listener that sees this for any write in a change has no patches to invert for it
 * and falls back to a full snapshot. Share its identity across module formats.
 */
export const PATCH_OPAQUE: unique symbol = Symbol.for('react-carburetor/v1/patch-opaque');

/**
 * One write the proxy could describe precisely, enough to invert it without a diff:
 * `segments` are the raw, unescaped keys from the store root to the written field — cheap to
 * replay onto a plain object or a draft, unlike `path`, whose escaping has no declared inverse.
 */
export interface IWritePatch {
    /** The keys from the store root to the written field, in order. */
    segments: readonly string[];
    /** Whether the key was its own before the write (distinct from an own `undefined`). */
    previousExists: boolean;
    /** The actual value before the write; `undefined` when `previousExists` is false. */
    previous: unknown;
    /** Whether the key is its own after the write (distinct from an own `undefined`). */
    nextExists: boolean;
    /** The actual value after the write; `undefined` when `nextExists` is false. */
    next: unknown;
}

/** Delivers one patch per describable write, or PATCH_OPAQUE for one the proxy cannot describe. */
export type TPatchRecorder = (patch: IWritePatch | typeof PATCH_OPAQUE) => void;

/** Mutation and publication stream from one patch source; fields are stable for the attachment. */
export interface IPatchObserver {
    /** Called at mutation time for each patch, or PATCH_OPAQUE when no patch describes the write. */
    patch: TPatchRecorder;
    /** If present, scheduled before ordinary subscribers at each publication (after coalescing). */
    publication?: () => void;
    /**
     * If present, called with the exact restore argument immediately before its own installation,
     * after abort listeners have had the chance to supersede it. Nested restores pass their own
     * argument; consumers distinguish those calls by reference, not wire-state equality.
     */
    ownRestore?: (state: unknown) => void;
}

/**
 * Shared by every branch of a draft proxy, including proxies created before a listener attaches.
 * An opaque-only store still records exact write paths, but never constructs patch payloads:
 * its history captures the full wire snapshot on the same pre-publication patch signal.
 */
export type TPatchPort = {
    listener?: TPatchRecorder;
    opaque?: boolean;
};

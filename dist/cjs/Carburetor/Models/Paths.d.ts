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

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

/** Array length's writable flag changed: history must replay an owned graph, not grow a locked draft. */
export const PATCH_ARRAY_LENGTH_LOCK: unique symbol = Symbol.for('react-carburetor/v1/patch-array-length-lock');

/** Own-key positions changed: history needs an owned endpoint to restore their order. */
export const PATCH_KEY_ORDER_CHANGE: unique symbol = Symbol.for('react-carburetor/v1/patch-key-order-change');

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

/** Delivers a field patch, opaque write, or structural transition requiring owned replay. */
export type TPatchRecorder = (
    patch: IWritePatch | typeof PATCH_OPAQUE | typeof PATCH_ARRAY_LENGTH_LOCK | typeof PATCH_KEY_ORDER_CHANGE
) => void;
/** A library installation's causality and graph ownership at its publication boundary. */
interface IStateInstallationDelivery {
    /** Force wildcard publication when an out-of-graph wire fact changes. */
    wildcard?: true;
    /** Whether publication is synchronous or queued for the next microtask. */
    publication?: 'sync' | 'deferred';
}

export type IStateInstallation =
    | ({
        origin: 'replacement';
        owner?: never;
        representation: 'public';
    } & IStateInstallationDelivery)
    | ({
        origin: 'restore';
        owner?: object;
        representation: 'public' | 'history-owned';
    } & IStateInstallationDelivery)
    | ({
        origin: 'operational';
        owner: object;
        representation: 'owned-operational';
    } & IStateInstallationDelivery);
/** Shared immutable context for the ordinary public root-replacement fast path. */
export const STATE_PUBLIC_REPLACEMENT: IStateInstallation =
    Object.freeze({origin: 'replacement', representation: 'public'});

/** A publication fact exists for every completed operation; several coalesced operations are mixed. */
export interface IStatePublication {
    /** Mutation is an in-place producer write; installation origins name root replacements. */
    origin: 'mutation' | 'replacement' | 'restore' | 'operational' | 'mixed';
    /** Opaque identity for the request/answer or exact history installation that owns it. */
    owner?: object;
    /** The representation accepted by this operation. */
    representation?: 'public' | 'history-owned' | 'owned-operational';
    /** The original route's requested delivery policy. */
    publication?: 'sync' | 'deferred';
}

/** Shared allocation-free facts for ordinary and coalesced in-place publications. */
export const STATE_MUTATION_PUBLICATION: IStatePublication = Object.freeze({origin: 'mutation'});
export const STATE_MIXED_PUBLICATION: IStatePublication = Object.freeze({origin: 'mixed'});

/** Exact history graph ownership claimed before restore installs its argument. */
export interface IStateRestoreClaim {
    /** Recorder operation token, absent when a custom producer uses only the adoption boolean. */
    owner?: object;
    /** This is the graph policy of the history endpoint that was claimed. */
    representation: 'history-owned';
    /** The source may adopt this graph as-is instead of copying/applying its values. */
    adopt: boolean;
}

/** Mutation and publication stream from one patch source; fields are stable for the attachment. */
export interface IPatchObserver {
    /** Called at mutation time for each field patch, opaque write, or owned-replay transition. */
    patch: TPatchRecorder;
    /** If present, scheduled before ordinary subscribers at each publication (after coalescing). */
    publication?: (fact?: IStatePublication) => void;
    /**
     * Owned-restore adoption signal for source extensions. Return true only when the exact
     * restore argument is a freshly detached graph the producer may adopt as-is.
     */
    ownRestore?: (state: unknown) => boolean;
    /**
     * Optional exact installation claim used by sources that propagate operation ownership
     * through publication. It does not change whether the original graph may be adopted.
     */
    restoreClaim?: (state: unknown) => IStateRestoreClaim | undefined;
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

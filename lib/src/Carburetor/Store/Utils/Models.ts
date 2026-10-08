import {TSubscriber} from '@/Carburetor/Models/Base';
import {
    IStateInstallation, IWritePatch, TPath, TPathSet,
} from '@/Carburetor/Models/Paths';

/**
 * Internal subscription protocol, keyed by shared symbols so two copies of the package in one
 * process interoperate (R30-06). Not exported from the package barrel: the path grammar these
 * members accept is an engine internal (R16-10).
 */

/** Grows one subscription's read set by one path; an unknown id is a no-op. */
export const CARBURETOR_EXTEND: unique symbol = Symbol.for('react-carburetor/v1/subscription-extend');

/** Path-precise drift check: whether a write since `baselineVersion` could concern `reads`. */
export const CARBURETOR_HAS_DRIFT: unique symbol = Symbol.for('react-carburetor/v1/subscription-has-drift');

/** The paths written after a version, or undefined once the write log cannot enumerate them. */
export const CARBURETOR_PATHS_SINCE: unique symbol = Symbol.for('react-carburetor/v1/store-paths-since');

/** The raw objects each path written after a version mutated, or undefined when unanswerable. */
export const CARBURETOR_TARGETS_SINCE: unique symbol = Symbol.for('react-carburetor/v1/store-targets-since');

/** A selection consumer needs raw-target proofs: the store retains them until the returned release runs. */
export const CARBURETOR_TRACK_TARGETS: unique symbol = Symbol.for('react-carburetor/v1/store-track-targets');

/** Delivers one notification pass for a closed write set; the batch coordinator's entry point. */
export const CARBURETOR_NOTIFY_WRITES: unique symbol = Symbol.for('react-carburetor/v1/store-notify-writes');

/** History's draft replay: installs undo/redo patches through the draft, keeping the owner's fact. */
export const CARBURETOR_REPLAY_PATCHES: unique symbol = Symbol.for('react-carburetor/v1/store-replay-patches');

/** The snapshot version a computed exposes, including changes not yet announced. */
export const CARBURETOR_SNAPSHOT_VERSION: unique symbol = Symbol.for('react-carburetor/v1/computed-snapshot-version');

/** What a store source carries beyond the public subscription surface. */
export interface IInternalSubscriptionProtocol {
    [CARBURETOR_EXTEND]?: (id: string, path: TPath) => void;
    [CARBURETOR_HAS_DRIFT]?: (baselineVersion: number, reads: ReadonlySet<TPath>) => boolean;
    [CARBURETOR_TRACK_TARGETS]?: () => () => void;
    [CARBURETOR_NOTIFY_WRITES]?: (writes: TPathSet) => void;
    [CARBURETOR_PATHS_SINCE]?: (baselineVersion: number) => ReadonlyArray<TPath> | undefined;
    [CARBURETOR_TARGETS_SINCE]?: (baselineVersion: number) => ReadonlyMap<TPath, ReadonlySet<object>> | undefined;
    [CARBURETOR_REPLAY_PATCHES]?: (
        patches: readonly IWritePatch[], inverse: boolean, installation: IStateInstallation
    ) => void;
    [CARBURETOR_SNAPSHOT_VERSION]?: () => number;
}

/** One registered subscription: its callback, scheduling key and the read set it is filed under. */
export interface ISubscriberRecord {
    callback: TSubscriber; schedulerKey: string; generation: number;
    matchedVersion: number; growthVersion: number; reads: TPathSet;
}

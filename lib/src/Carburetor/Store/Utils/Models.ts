import {TPath} from '@/Carburetor/Models/Paths';

/**
 * Internal subscription protocol, keyed by shared symbols so two copies of the package in one
 * process interoperate (R30-06). Not exported from the package barrel: the path grammar these
 * members accept is an engine internal (R16-10).
 */

/** Grows one subscription's read set by one path; an unknown id is a no-op. */
export const CARBURETOR_EXTEND: unique symbol = Symbol.for('react-carburetor/v1/subscription-extend');

/** Path-precise drift check: whether a write since `baselineVersion` could concern `reads`. */
export const CARBURETOR_HAS_DRIFT: unique symbol = Symbol.for('react-carburetor/v1/subscription-has-drift');

/** What a store source carries beyond the public subscription surface. */
export interface IInternalSubscriptionProtocol {
    [CARBURETOR_EXTEND]?: (id: string, path: TPath) => void;
    [CARBURETOR_HAS_DRIFT]?: (baselineVersion: number, reads: ReadonlySet<TPath>) => boolean;
}

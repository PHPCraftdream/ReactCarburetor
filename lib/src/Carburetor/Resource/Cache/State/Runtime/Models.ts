import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {IResourceEntry} from "@/Carburetor/Models/Resource";

/** Default freshness duration for successful resource entries. */
export const DEFAULT_TTL: number = 30_000;
/** Default capacity for unretained resource entries. */
export const DEFAULT_MAX_ENTRIES: number = 100;

/** One active cache request and its invalidation/retry ownership. */
export interface ICacheRequest {
    /** The signal whose abort event detaches this request. */
    controller: AbortController;
    /** The shared answer promise returned by load/refresh and thrown by suspend. */
    promise: Promise<void>;
    /** Monotonic owner generation for this key. */
    generation: number;
    /** Invalidation epoch captured when this request started. */
    invalidationEpoch: number;
    /** Whether this request temporarily hides a prior raw failure. */
    retryingFailure: boolean;
}

/** Raw request rejection owned by one settled entry. */
export interface ICacheFailure {
    /** Rejected value, including undefined. */
    value: unknown;
    /** Serializable description stored in the entry. */
    message: string;
    /** Entry status to which this failure belongs. */
    status: EResourceStatus;
}

/** Cache answer identity and optional raw failure for its exact entry. */
export interface ICacheAnswer<T> {
    /** Cache key under which this answer settled. */
    key: string;
    /** Exact live entry object that owns the answer. */
    entry: IResourceEntry<T>;
    /** Present exactly when a raw rejection belongs to this entry. */
    failure?: ICacheFailure;
}

/** Per-key owner record, retained only while a request or raw failure exists. */
export interface ICacheRuntime<T> {
    /** Latest request owner generation for this key. */
    generation: number;
    /** Current invalidation epoch against which requests settle. */
    invalidationEpoch: number;
    /** The only request allowed to join or settle for this key. */
    request?: ICacheRequest;
    /** The last raw failure owner, if this key currently has one. */
    answer?: ICacheAnswer<T>;
}

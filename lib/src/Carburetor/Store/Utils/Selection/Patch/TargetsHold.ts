import {TDisposer} from "@/Carburetor/Models/Base";
import {CARBURETOR_TRACK_TARGETS, IInternalSubscriptionProtocol} from "@/Carburetor/Store/Utils/Models";

const nothing: TDisposer = () => undefined;

/**
 * R39-04: one consumer's single ownership of one store's write proofs. While owned the store
 * retains them; releasing the last owner returns the store to the cost of one nobody patches from.
 */
export class TargetsHold {
    /** The store currently owned. */
    private source: object | undefined;
    /** Releases that ownership. */
    private release: TDisposer | undefined;

    /** Owns `source` (releasing any other), or nothing for undefined; a repeat call is free.
     *
     * @param source - the store to own, or undefined to release; a source without the protocol is a no-op
     */
    public sync(source: object | undefined): void {
        if (this.source === source) return;
        this.release?.();
        this.source = source;
        this.release = source === undefined ? undefined
            : (source as IInternalSubscriptionProtocol)[CARBURETOR_TRACK_TARGETS]?.call(source) ?? nothing;
    }
}

import * as React from "react";
import {ScopedAntiHookComponent} from "@/Carburetor";
import {statusToken} from "@/ToDo/Scope/Tokens/statusToken";

/**
 * The last emit timestamp changes on every write to the list, so it has to be read by
 * a separate small component — otherwise the whole list would re-render with it.
 */
export class EmitStatus extends ScopedAntiHookComponent {
    /** Reads the timestamp alone, through the per-render useCarburetor form. */
    public render() {
        const {emittedMessage} = this.useCarburetor(this.resolve(statusToken));

        return (
            <span className="truncate" data-testid="emitted-message">
                {emittedMessage}
            </span>
        );
    }
}

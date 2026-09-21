import * as React from "react";
import {AntiHookComponent} from "@/Carburetor";
import {someCarburetor} from "@/ToDo/Carburetors/SomeCarburetorInstance";

/**
 * The last emit timestamp changes on every write to the list, so it has to be read by
 * a separate small component — otherwise the whole list would re-render with it.
 */
export class EmitStatus extends AntiHookComponent {
    /** Reads the timestamp alone, so the list is not re-rendered by it. */
    public render() {
        const {emittedMessage} = this.useCarburetor(someCarburetor);

        return (
            <span className="truncate" data-testid="emitted-message">
                {emittedMessage}
            </span>
        );
    }
}

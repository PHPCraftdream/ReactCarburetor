import {Carburetor} from "@/Carburetor";
import {ISomeCarburetor} from "./Models";

export class SomeCarburetor extends Carburetor<ISomeCarburetor> {
    /** Render counter is demo instrumentation, not state — it does not belong in data. */
    protected renderCount: number = 0;

    /** Counts calls, to show in the demo how rarely a component actually re-renders. */
    public printRenderCount = (): number => {
        this.renderCount++;

        return this.renderCount;
    };

    /** Records when the last update went out, which the demo displays. */
    public setEmittedMessage = (emittedMessage: string): ISomeCarburetor => {
        this.update((draft: ISomeCarburetor) => {
            draft.emittedMessage = emittedMessage;
        });

        return this.data;
    };
}

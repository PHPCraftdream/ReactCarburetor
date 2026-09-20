import {Carburetor} from "../../Carburetor";
import {ISomeCarburetor} from "./Models";

export class SomeCarburetor extends Carburetor<ISomeCarburetor> {
    /** Render counter is demo instrumentation, not state — it does not belong in data. */
    protected renderCount: number = 0;

    public printRenderCount = (): number => {
        this.renderCount++;

        return this.renderCount;
    };

    public setEmittedMessage = (emittedMessage: string): ISomeCarburetor => {
        this.update((draft: ISomeCarburetor) => {
            draft.emittedMessage = emittedMessage;
        });

        return this.data;
    };
}

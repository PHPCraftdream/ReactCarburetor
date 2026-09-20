import {Carburetor} from "../Carburetor";

export interface ISomeCarburetor {
    emittedMessage: string;
}

export const getInitialSomeData = (): ISomeCarburetor => {
    return {
        emittedMessage: ''
    };
};

export class SomeCarburetor extends Carburetor<ISomeCarburetor> {
    /** Render counter is demo instrumentation, not state — it does not belong in data. */
    protected renderCount: number = 0;

    public printRenderCount = (): number => {
        this.renderCount++;

        return this.renderCount;
    };

    public setEmittedMessage = (emittedMessage: string): ISomeCarburetor => {
        this.draft.emittedMessage = emittedMessage;

        this.emitUpdate();

        return this.data;
    };
}

export const someCarburetor = new SomeCarburetor(getInitialSomeData());

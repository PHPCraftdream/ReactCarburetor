import {Carburetor} from "@/Carburetor";
import {IStatusData} from "./Models";

export class StatusCarburetor extends Carburetor<IStatusData> {
    /** Render counter is demo instrumentation, not state — it does not belong in data. */
    protected renderCount: number = 0;

    /** Counts calls, to show in the demo how rarely a component actually re-renders. */
    public printRenderCount = (): number => {
        this.renderCount++;

        return this.renderCount;
    };

    /** Records when the last update went out, which the demo displays. */
    public setEmittedMessage = (emittedMessage: string): IStatusData => {
        this.update((draft: IStatusData) => {
            draft.emittedMessage = emittedMessage;
        });

        return this.data;
    };
}

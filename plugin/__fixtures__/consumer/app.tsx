import {AntiHookComponent, Carburetor} from "react-carburetor";
import {store} from "../sources";

/** A consumer-shaped file: two hazards, one of each severity the preset assigns. */
export class Row extends AntiHookComponent {
    public render() {
        // error: no-get-data-in-render
        return <span>{store.getData().title}</span>;
    }
}

export class TitleCarburetor extends Carburetor<{title: string}> {
    public setTitle = (title: string) => {
        // warn: no-direct-data-write
        this.data.title = title;

        this.emitUpdate();
    };
}

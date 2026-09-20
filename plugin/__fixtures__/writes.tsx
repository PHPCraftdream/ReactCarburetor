import {AntiHookComponent, Carburetor} from "react-carburetor";
import {store} from "./sources";

/**
 * Fixture for the end-to-end host check: every rule in the writes group must fire exactly once
 * here. This file is linted by a test, not by `npm run lint`.
 */
export class DemoCarburetor extends Carburetor<{title: string; count: number}> {
    public setTitle = (title: string) => {
        // require-emit-after-draft-write
        this.draft.title = title;
    };

    public setCount = (count: number) => {
        // no-direct-data-write
        this.data.count = count;

        this.emitUpdate();
    };

    public put = (key: string, value: number) => {
        // no-untrackable-draft-mutation
        this.draft.index.set(key, value);

        this.emitUpdate();
    };
}

// no-external-data-mutation
export const renameFromOutside = (title: string): void => {
    store.getData().title = title;
};

export class Row extends AntiHookComponent {
    public render() {
        const data = this.useCarburetor(store);

        // no-store-write-in-render
        store.markSeen();

        // no-tracked-data-mutation
        data.title = 'x';

        return <span>{data.title}</span>;
    }
}

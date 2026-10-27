import {AntiHookComponent, computed} from "@react-carburetor/core";
import {store, visibleCount} from "./sources";

/**
 * Fixture for the end-to-end host check: every rule in the reads group must fire exactly once
 * here. This file is linted by a test, not by `npm run lint`.
 */
export class Row extends AntiHookComponent<{id: string}> {
    protected lastData: unknown = undefined;

    public componentDidMount(): void {
        super.componentDidMount();

        // no-use-carburetor-outside-render
        this.lastData = this.useCarburetor(store);
    }

    public render() {
        // no-get-data-in-render
        const title = store.getData().items[this.props.id].title;

        // no-computed-get-in-render
        const count = visibleCount.get();

        // a keyed `get` is somebody else's `get`: the rule's argument guard must keep it silent
        const keyed = new Map([[1, 'x']]).get(1);

        const data = this.useCarburetor(store);

        // no-escaping-tracked-data
        this.lastData = data;

        return <span onClick={() => console.log(title, count, keyed)}>{data.items[this.props.id].title}</span>;
    }
}

// no-computed-get-in-computed
export const doubled = computed(() => visibleCount.get() * 2);

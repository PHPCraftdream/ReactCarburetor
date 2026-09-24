import {AntiHookComponent, computed} from "react-carburetor";
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

        const data = this.useCarburetor(store);

        // no-escaping-tracked-data
        this.lastData = data;

        return <span onClick={() => console.log(title, count)}>{data.items[this.props.id].title}</span>;
    }
}

// no-computed-get-in-computed
export const doubled = computed(() => visibleCount.get() * 2);

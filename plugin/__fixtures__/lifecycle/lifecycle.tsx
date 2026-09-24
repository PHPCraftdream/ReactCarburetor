import {AntiHookComponent} from "react-carburetor";
import {store} from "./sources";

/**
 * Fixture for the end-to-end host check: every rule in the lifecycle group must fire exactly once
 * here. This file is linted by a test, not by `npm run lint`.
 */
export class Row extends AntiHookComponent<{id: string}> {
    // no-lifecycle-class-property
    public componentDidUpdate = (): void => {
        this.sync();
    };

    // require-super-in-lifecycle
    public componentDidMount(): void {
        this.sync();
    }

    // require-bind-for-passed-method
    protected onToggle(): void {
        store.toggle(this.props.id);
    }

    protected sync(): void {
        store.getData(this.props.id);
    }

    public render() {
        const data = this.useCarburetor(store);

        return <div>
            <button onClick={this.onToggle}>toggle</button>
            {/* no-handler-created-in-render */}
            <TodoRow onDelete={() => store.deleteTodo(this.props.id)} title={data.title}/>
        </div>;
    }
}

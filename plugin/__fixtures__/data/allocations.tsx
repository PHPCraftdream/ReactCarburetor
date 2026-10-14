import {AntiHookComponent} from "react-carburetor";
import {store} from "./sources";

/**
 * Fixture for the conformance corpus: each allocation rule must fire exactly once here. This file
 * is linted by a test, not by `npm run lint`.
 */
export class AllocationRow extends AntiHookComponent {
    // require-method-for-closure: a DOM attribute closure rebuilt on every render
    public render() {
        return <button onClick={() => this.toggle()}>toggle</button>;
    }

    // require-module-function: a member that uses nothing from the class
    protected sync(): void {
        store.getData();
    }
}

export class AllocationList extends AntiHookComponent {
    // no-function-in-render: a per-item handler rebuilt on every render
    public render() {
        const items = [{id: 1, name: "one"}];

        return <ul>{items.map((item) => <li key={item.id} onClick={() => this.pick(item.id)}>{item.name}</li>)}</ul>;
    }

    protected pick(id: number): void {
        void id;
    }
}

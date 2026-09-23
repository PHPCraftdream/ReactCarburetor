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

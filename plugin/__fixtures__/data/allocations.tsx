import {AntiHookComponent, Carburetor} from "react-carburetor";
import {store} from "./sources";

/**
 * Fixture for the conformance corpus: each allocation rule must fire exactly once here, except
 * where two of them legitimately cover one spot and the overlap rules yield. This file
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

export interface ICounterData {
    count: number;
}

export class ClosureUpdateCounter extends Carburetor<ICounterData> {
    // no-closure-in-update: the arrow is rebuilt on every call of `set` and captures `n` and `this`
    public set(n: number): void {
        this.update(() => {
            this.draft.count = n;
        });
    }

    // fine: a bare method reference captures nothing, so it is not this rule's finding
    public reset(): void {
        this.update(this.clear);
    }

    protected clear(): void {
        this.update((draft) => {
            draft.count = 0;
        });
    }
}

export class DedupCells extends AntiHookComponent {
    // no-function-in-render and require-module-function cover the same map callback (it captures
    // nothing, so H29 does not fire): H31 yields to H30 host-side, per native's default dedup.
    public render() {
        const cells = [{id: 1, name: "one"}];

        return <ul>{cells.map((cell) => <li key={cell.id}>{cell.name}</li>)}</ul>;
    }
}

// require-module-function with the default scope: a nested function in a plain module function
// that uses nothing from the function it sits in belongs at module level.
export function allocationHeading(): () => string {
    return () => "Allocations";
}

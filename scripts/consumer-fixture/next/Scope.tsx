"use client";

import * as React from "react";
import {
    Carburetor,
    CarburetorProvider,
    CarburetorScope,
    Computed,
    ScopedAntiHookComponent,
    carburetorToken,
} from "react-carburetor";
import {useCarburetorValue, useComputedValue} from "react-carburetor/interop";

/** Store shape shared by the scoped and the hooks consumer. */
class ScopeStore extends Carburetor<{count: number}> {}

const token = carburetorToken(() => new ScopeStore({count: 5}), 'next-fixture/scoped');
const hooksStore = new ScopeStore({count: 9});
const doubled = new Computed<number>((read) => read(hooksStore).count * 2);

class Scoped extends ScopedAntiHookComponent {
    /** Resolves the scope-backed store and renders its tracked count. */
    public render(): React.ReactNode {
        return <span>{`scoped:${this.useCarburetor(this.resolve(token)).count}`}</span>;
    }
}

/** Renders both interop hooks. */
function Hooks(): React.ReactElement {
    const count = useCarburetorValue(hooksStore, (data) => data.count);

    return <span>{`hooks:${count}:${useComputedValue(doubled)}`}</span>;
}

/** Owns the scope: a class instance cannot cross from a server component as a prop. */
export function Scope(): React.ReactElement {
    const [scope] = React.useState(() => new CarburetorScope());

    return (
        <CarburetorProvider scope={scope}>
            <Scoped />
            <Hooks />
        </CarburetorProvider>
    );
}

"use client";

import * as React from "react";
import {AntiHookComponent, Carburetor} from "react-carburetor";

/** A client-side store read through connect(). */
class CounterStore extends Carburetor<{count: number}> {}

const store = new CounterStore({count: 3});

export class Counter extends AntiHookComponent {
    /** A persistent connect() view of the module-level store. */
    private readonly view = this.connect(store);

    /** Renders the tracked count. */
    public render(): React.ReactNode {
        return <span>{`client:${this.view.count}`}</span>;
    }
}

"use client";

import * as React from "react";
import {CarburetorContext} from "./CarburetorContext";
import {CarburetorScope} from "./CarburetorScope";
import {ICarburetorToken} from "../../Models/Tooling";

interface ICarburetorChildScopeProps {
    /** Tokens created and owned by the child scope; fixed for the boundary's lifetime. */
    tokens: readonly ICarburetorToken<unknown>[];
    /** Subtree that resolves tokens through the child scope. */
    children?: React.ReactNode;
}

interface ICarburetorChildScopeState {
    /** The child scope provided to the subtree; null until the boundary has mounted. */
    scope: CarburetorScope | null;
    /** The parent scope the child was created from. */
    parent: CarburetorScope | null;
}

/** Provides a child scope that owns its declared local token ids and disposes it on unmount or parent change. */
export class CarburetorChildScope extends React.Component<ICarburetorChildScopeProps, ICarburetorChildScopeState> {
    /** Reads the parent scope published by the nearest provider. */
    public static contextType = CarburetorContext;
    /** The parent scope from the nearest provider, or null when there is none. */
    public declare context: React.ContextType<typeof CarburetorContext>;
    /** The child scope this boundary created and must dispose. */
    protected ownedScope: CarburetorScope | null = null;

    /** Creates the boundary instance.
     *
     * @param props - component properties including stable local tokens and children
     */
    public constructor(props: ICarburetorChildScopeProps) {
        super(props);
        this.state = {scope: null, parent: null};
    }

    /** Creates the child scope once the boundary is committed. */
    public componentDidMount(): void {
        this.adopt();
    }

    /** Rebuilds the child scope when the nearest provider now publishes another parent. */
    public componentDidUpdate(): void {
        if (this.state.parent !== this.context) this.adopt();
    }

    /** Disposes the child scope together with the boundary. */
    public componentWillUnmount(): void {
        this.release();
    }

    /** Provides the child scope, and nothing while it belongs to a previous parent. */
    public render(): React.ReactNode {
        if (this.context === null) throw new Error('CarburetorChildScope requires a parent scope');
        const {scope, parent} = this.state;
        if (scope === null || parent !== this.context) return null;
        return <CarburetorContext.Provider value={scope}>{this.props.children}</CarburetorContext.Provider>;
    }

    /** Replaces the owned child scope with one created from the current parent. */
    protected adopt(): void {
        const parent = this.context;
        if (parent === null) throw new Error('CarburetorChildScope requires a parent scope');
        this.release();
        this.ownedScope = parent.child(this.props.tokens);
        this.setState({scope: this.ownedScope, parent});
    }

    /** Disposes the owned child scope, if any. */
    protected release(): void {
        this.ownedScope?.dispose();
        this.ownedScope = null;
    }
}

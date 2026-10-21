"use client";

import * as React from "react";
import {CarburetorContext} from "./CarburetorContext";
import {CarburetorScope} from "./CarburetorScope";
import {ICarburetorToken} from "@/Carburetor/Models/Tooling";

interface ICarburetorChildScopeProps {
    tokens: readonly ICarburetorToken<unknown>[];
    children?: React.ReactNode;
}

interface ICarburetorChildScopeState {
    scope: CarburetorScope | null;
}

/** Provides a child scope that owns its declared local token ids. */
export class CarburetorChildScope extends React.Component<ICarburetorChildScopeProps, ICarburetorChildScopeState> {
    public static contextType = CarburetorContext;
    public declare context: React.ContextType<typeof CarburetorContext>;
    protected ownedScope: CarburetorScope | null = null;

    /** Creates the boundary instance.
     *
     * @param props - component properties including stable local tokens and children
     */
    public constructor(props: ICarburetorChildScopeProps) {
        super(props);
        this.state = {scope: null};
    }

    public componentDidMount(): void {
        const parent = this.context;
        if (parent === null) throw new Error('CarburetorChildScope requires a parent scope');
        this.ownedScope = parent.child(this.props.tokens);
        this.setState({scope: this.ownedScope});
    }

    public componentWillUnmount(): void {
        this.ownedScope?.dispose();
        this.ownedScope = null;
    }

    public render(): React.ReactNode {
        if (this.context === null) throw new Error('CarburetorChildScope requires a parent scope');
        const scope = this.state.scope;
        if (scope === null) return null;
        return <CarburetorContext.Provider value={scope}>{this.props.children}</CarburetorContext.Provider>;
    }
}

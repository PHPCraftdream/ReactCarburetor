import * as React from "react";
import {CarburetorContext} from "./CarburetorContext";
import {CarburetorScope} from "./CarburetorScope";

interface ICarburetorProviderProps {
    scope: CarburetorScope;
    children?: React.ReactNode;
}

export class CarburetorProvider extends React.Component<ICarburetorProviderProps> {
    /** Publishes the scope to the subtree; scoped components resolve tokens through it. */
    public render() {
        return (
            <CarburetorContext.Provider value={this.props.scope}>
                {this.props.children}
            </CarburetorContext.Provider>
        );
    }
}

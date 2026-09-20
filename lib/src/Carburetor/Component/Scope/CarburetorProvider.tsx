import * as React from "react";
import {CarburetorContext} from "./CarburetorContext";
import {CarburetorScope} from "./CarburetorScope";

interface ICarburetorProviderProps {
    scope: CarburetorScope;
    children?: React.ReactNode;
}

export class CarburetorProvider extends React.Component<ICarburetorProviderProps> {
    public render() {
        return (
            <CarburetorContext.Provider value={this.props.scope}>
                {this.props.children}
            </CarburetorContext.Provider>
        );
    }
}

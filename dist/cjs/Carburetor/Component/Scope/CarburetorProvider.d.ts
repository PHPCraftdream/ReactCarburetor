import * as React from "react";
import { CarburetorScope } from "./CarburetorScope.js";
interface ICarburetorProviderProps {
    scope: CarburetorScope;
    children?: React.ReactNode;
}
export declare class CarburetorProvider extends React.Component<ICarburetorProviderProps> {
    /** Publishes the scope to the subtree; scoped components resolve tokens through it. */
    render(): React.JSX.Element;
}
export {};

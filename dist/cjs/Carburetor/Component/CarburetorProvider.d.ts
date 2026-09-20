import * as React from "react";
import { CarburetorScope } from "./CarburetorScope.js";
interface ICarburetorProviderProps {
    scope: CarburetorScope;
    children?: React.ReactNode;
}
export declare class CarburetorProvider extends React.Component<ICarburetorProviderProps> {
    render(): React.JSX.Element;
}
export {};

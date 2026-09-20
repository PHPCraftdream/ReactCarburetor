import * as React from "react";
import {CarburetorScope} from "./CarburetorScope";

export const CarburetorContext: React.Context<CarburetorScope | null> =
    React.createContext<CarburetorScope | null>(null);

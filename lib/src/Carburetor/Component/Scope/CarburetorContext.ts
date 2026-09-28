"use client";

import * as React from "react";
import {sharedSingleton} from "@/Carburetor/Store/Utils/sharedSingleton";
import {CarburetorScope} from "./CarburetorScope";

/**
 * Shared across every copy of the library in this process; see sharedSingleton. React is
 * identified by `Component`: CJS exports and an ESM namespace of one React are different objects.
 */
export const CarburetorContext: React.Context<CarburetorScope | null> = sharedSingleton(
    'CarburetorContext',
    () => React.createContext<CarburetorScope | null>(null),
    React.Component
);

import * as React from "react";
import { CarburetorScope } from "./CarburetorScope.js";
/**
 * Shared across every copy of the library in this process; see sharedSingleton. React is
 * identified by `Component`: CJS exports and an ESM namespace of one React are different objects.
 */
export declare const CarburetorContext: React.Context<CarburetorScope | null>;

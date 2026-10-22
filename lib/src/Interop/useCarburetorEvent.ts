"use client";

import {useEffect} from "react";
import type {ICarburetorEvents} from "../Carburetor/Models/Store";

/** Subscribes a carburetor event handler for the lifetime of the supplied subscription arguments.
 *
 * @param store - the event-capable carburetor
 * @param name - the event name to receive
 * @param handler - called with each matching event payload
 */
export const useCarburetorEvent = <TEvents extends object, K extends keyof TEvents>(
    store: ICarburetorEvents<TEvents>,
    name: K,
    handler: (payload: TEvents[K]) => void
): void => {
    useEffect(() => store.on(name, handler), [store, name, handler]);
};

import * as React from "react";
import {Carburetor} from "react-carburetor";
import {Counter} from "./Counter";
import {Scope} from "./Scope";

/**
 * A server component importing the package barrel, which also re-exports the client modules:
 * they must arrive as client references instead of being evaluated against react-server.
 */
class ServerStore extends Carburetor<{count: number}> {}

const store = new ServerStore({count: 7});

/** Renders one server-side store value next to two client subtrees. */
export default function Page(): React.ReactElement {
    return (
        <main>
            <span>{
                // oxlint-disable-next-line carburetor/max-line-length
                // carburetor-disable-next-line carburetor/no-get-data-in-render -- Server Component: one-shot read, no subscription exists on the server
                `server:${store.getData().count}`
            }</span>
            <Counter />
            <Scope />
        </main>
    );
}

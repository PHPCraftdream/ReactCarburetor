import {IDict, TDisposer} from "@/Carburetor/Models/Base";
import {EDevToolsAction} from "@/Carburetor/Models/Enums/EDevToolsAction";
import {EDevToolsMessageType} from "@/Carburetor/Models/Enums/EDevToolsMessageType";
import {IInspectable} from "@/Carburetor/Models/Store";
import {IDevToolsExtension, IDevToolsMessage, IDevToolsOptions} from "@/Carburetor/Models/Tooling";
import {getUid} from "@/Carburetor/Store/Utils/getUid";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";

const findExtension = (): IDevToolsExtension | undefined => {
    const host = globalThis as {__REDUX_DEVTOOLS_EXTENSION__?: IDevToolsExtension};

    return host.__REDUX_DEVTOOLS_EXTENSION__;
};

/**
 * Publishes the state of the given carburetors to the Redux DevTools extension and
 * applies time travel back onto them. Returns a disposer; if no extension is available
 * the call is a no-op.
 *
 * @param carburetors - keyed by name; each name becomes a top-level key of the published state
 * @param options - `extension` replaces the auto-discovered Redux extension, `name` titles the connection
 */
export const connectDevTools = (carburetors: IDict<IInspectable>, options: IDevToolsOptions = {}): TDisposer => {
    const extension = options.extension || findExtension();

    if (!extension) {
        return () => undefined;
    }

    const connection = extension.connect({name: options.name || 'React Carburetor'});
    const subscriberId = getUid();
    const names = Object.keys(carburetors);
    let applyingTimeTravel = false;

    const snapshots: IDict<{state: unknown; version: number}> = {};

    // A payload copies each store once and then reuses that copy until the store's version
    // moves. Every version is checked on every composition: the notification is named after
    // one store, but a transaction may already have changed the others by the time it fires,
    // so refreshing only the named store would publish a payload mixing old and new states.
    const composeState = (): IDict<unknown> => {
        const state: IDict<unknown> = {};

        names.forEach((name: string) => {
            const version = carburetors[name].getVersion();
            const cached = snapshots[name];

            if (!cached || cached.version !== version) {
                snapshots[name] = {state: carburetors[name].toJSON(), version};
            }

            state[name] = snapshots[name].state;
        });

        return state;
    };

    connection.init(composeState());

    const publish = (name: string) => {
        if (applyingTimeTravel) {
            return;
        }

        connection.send(name + '/update', composeState());
    };

    names.forEach((name: string) => {
        carburetors[name].subscribe(() => publish(name), {id: subscriberId, reads: new Set([WILDCARD_PATH])});
    });

    const applyState = (serialized: string | undefined) => {
        if (!serialized) {
            return;
        }

        const next = JSON.parse(serialized) as IDict<unknown>;

        applyingTimeTravel = true;

        try {
            names.forEach((name: string) => {
                if (name in next) {
                    carburetors[name].fromJSON(next[name]);
                }
            });
        } finally {
            applyingTimeTravel = false;
        }
    };

    const unsubscribeFromExtension = connection.subscribe((message: IDevToolsMessage) => {
        if (message.type !== EDevToolsMessageType.Dispatch || !message.payload) {
            return;
        }

        const action = message.payload.type;

        if (action === EDevToolsAction.JumpToAction
            || action === EDevToolsAction.JumpToState
            || action === EDevToolsAction.Rollback) {
            applyState(message.state);
        }
    });

    return () => {
        names.forEach((name: string) => carburetors[name].unsubscribe(subscriberId));

        if (typeof unsubscribeFromExtension === 'function') {
            unsubscribeFromExtension();
        }
    };
};

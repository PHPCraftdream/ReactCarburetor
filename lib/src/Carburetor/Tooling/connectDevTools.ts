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

const composeState = (carburetors: IDict<IInspectable>): IDict<unknown> => {
    const state: IDict<unknown> = {};

    Object.keys(carburetors).forEach((name: string) => {
        state[name] = carburetors[name].toJSON();
    });

    return state;
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

    connection.init(composeState(carburetors));

    const publish = (name: string) => {
        if (applyingTimeTravel) {
            return;
        }

        connection.send(name + '/update', composeState(carburetors));
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

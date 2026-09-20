import {IDict, IInspectable, TDisposer} from "./Models";
import {WILDCARD_PATH} from "./Paths";
import {getUid} from "./Utils/getUid";

/** The slice of the Redux DevTools protocol this integration needs. */
export interface IDevToolsMessage {
    type: string;
    payload?: {
        type?: string;
        actionId?: number;
    };
    state?: string;
}

export interface IDevToolsConnection {
    init: (state: unknown) => void;
    send: (action: string, state: unknown) => void;
    subscribe: (listener: (message: IDevToolsMessage) => void) => TDisposer | void;
}

export interface IDevToolsExtension {
    connect: (options: {name?: string}) => IDevToolsConnection;
}

export interface IDevToolsOptions {
    name?: string;
    /** Injectable for tests and for environments without the browser extension. */
    extension?: IDevToolsExtension;
}

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
        carburetors[name].subscribe(() => publish(name), subscriberId, new Set([WILDCARD_PATH]));
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
        if (message.type !== 'DISPATCH' || !message.payload) {
            return;
        }

        const action = message.payload.type;

        if (action === 'JUMP_TO_ACTION' || action === 'JUMP_TO_STATE' || action === 'ROLLBACK') {
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

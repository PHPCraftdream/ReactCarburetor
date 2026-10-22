import {IDict, TDisposer} from "../Models/Base";
import {EDevToolsAction} from "../Models/Enums/EDevToolsAction";
import {EDevToolsMessageType} from "../Models/Enums/EDevToolsMessageType";
import {IInspectable} from "../Models/Store";
import {IDevToolsExtension, IDevToolsMessage, IDevToolsOptions} from "../Models/Tooling";
import {getUid} from "../Store/Utils/getUid";
import {WILDCARD_PATH} from "../Store/Paths/WildcardPath";

const noop = (): undefined => undefined;

const findExtension = (): IDevToolsExtension | undefined => {
    const host = globalThis as {__REDUX_DEVTOOLS_EXTENSION__?: IDevToolsExtension};

    return host.__REDUX_DEVTOOLS_EXTENSION__;
};

/**
 * Publishes the state of the given carburetors to the Redux DevTools extension and
 * applies time travel back onto them. Returns a disposer; if no extension is available
 * the call is a no-op.
 *
 * Every update publishes one action per notifying store. A time-travel jump is never
 * published back, even when a deferring scheduler delivers the matching update after
 * the jump has been applied.
 *
 * @param carburetors - keyed by name; each name becomes a top-level key of the published state
 * @param options - `extension` replaces the auto-discovered Redux extension, `name` titles the connection
 */
export const connectDevTools = (carburetors: IDict<IInspectable>, options: IDevToolsOptions = {}): TDisposer => {
    const extension = options.extension || findExtension();

    if (!extension) {
        return noop;
    }

    const connection = extension.connect({name: options.name || 'React Carburetor'});
    const subscriberId = getUid();
    const names = Object.keys(carburetors);
    let applyingTimeTravel = false;
    // Versions installed by the last jump, per store name: a publication still at that
    // version is the jump's own echo (a deferred scheduler delivers it after the flag
    // below has been reset) and must not become a new DevTools action.
    const jumpedVersions: IDict<number> = Object.create(null);

    const snapshots: IDict<{state: unknown; version: number}> = Object.create(null);

    // A payload copies each store once and then reuses that copy until the store's version
    // moves. Every version is checked on every composition: the notification is named after
    // one store, but a transaction may already have changed the others by the time it fires,
    // so refreshing only the named store would publish a payload mixing old and new states.
    const composeState = (): IDict<unknown> => {
        const state: IDict<unknown> = Object.create(null);

        names.forEach((name: string) => {
            const version = carburetors[name].getVersion();
            const cached = snapshots[name];

            if (!cached || cached.version !== version) {
                snapshots[name] = {state: carburetors[name].snapshot(), version};
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

        // A publication still at the version the jump installed is the jump's own echo.
        const jumped = jumpedVersions[name];

        if (jumped !== undefined) {
            delete jumpedVersions[name];

            if (jumped === carburetors[name].getVersion()) {
                return;
            }
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
                if (Object.prototype.hasOwnProperty.call(next, name)) {
                    carburetors[name].fromJSON(next[name]);
                    jumpedVersions[name] = carburetors[name].getVersion();
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

import { EDevToolsAction } from "../Models/Enums/EDevToolsAction.mjs";
import { EDevToolsMessageType } from "../Models/Enums/EDevToolsMessageType.mjs";
import { getUid } from "../Store/Utils/getUid.mjs";
import { WILDCARD_PATH } from "../Store/Paths/WildcardPath.mjs";
const findExtension = ()=>{
    const host = globalThis;
    return host.__REDUX_DEVTOOLS_EXTENSION__;
};
const connectDevTools = (carburetors, options = {})=>{
    const extension = options.extension || findExtension();
    if (!extension) return ()=>void 0;
    const connection = extension.connect({
        name: options.name || 'React Carburetor'
    });
    const subscriberId = getUid();
    const names = Object.keys(carburetors);
    let applyingTimeTravel = false;
    const snapshots = {};
    const composeState = ()=>{
        const state = {};
        names.forEach((name)=>{
            const version = carburetors[name].getVersion();
            const cached = snapshots[name];
            if (!cached || cached.version !== version) snapshots[name] = {
                state: carburetors[name].toJSON(),
                version
            };
            state[name] = snapshots[name].state;
        });
        return state;
    };
    connection.init(composeState());
    const publish = (name)=>{
        if (applyingTimeTravel) return;
        connection.send(name + '/update', composeState());
    };
    names.forEach((name)=>{
        carburetors[name].subscribe(()=>publish(name), {
            id: subscriberId,
            reads: new Set([
                WILDCARD_PATH
            ])
        });
    });
    const applyState = (serialized)=>{
        if (!serialized) return;
        const next = JSON.parse(serialized);
        applyingTimeTravel = true;
        try {
            names.forEach((name)=>{
                if (name in next) carburetors[name].fromJSON(next[name]);
            });
        } finally{
            applyingTimeTravel = false;
        }
    };
    const unsubscribeFromExtension = connection.subscribe((message)=>{
        if (message.type !== EDevToolsMessageType.Dispatch || !message.payload) return;
        const action = message.payload.type;
        if (action === EDevToolsAction.JumpToAction || action === EDevToolsAction.JumpToState || action === EDevToolsAction.Rollback) applyState(message.state);
    });
    return ()=>{
        names.forEach((name)=>carburetors[name].unsubscribe(subscriberId));
        if ('function' == typeof unsubscribeFromExtension) unsubscribeFromExtension();
    };
};
export { connectDevTools };

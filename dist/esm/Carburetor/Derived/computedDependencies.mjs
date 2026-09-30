import { getUid } from "../Store/Utils/getUid.mjs";
import { sharedSingleton } from "../Store/Utils/sharedSingleton.mjs";
import { updateWave } from "../Store/Scheduling/UpdateWaveInstance.mjs";
const versions = sharedSingleton('computedVersions', ()=>new WeakMap());
const bridges = sharedSingleton('computedExternalBridges', ()=>new WeakMap());
const computedDependencies = {
    versions: versions,
    subscribe (source, callback, options) {
        if ('read' in source || versions.has(source)) return void source.subscribe(callback, options);
        const existing = bridges.get(source);
        if (existing) return void existing.subscribers.set(options.id, callback);
        const bridge = {
            id: getUid(),
            subscribers: new Map([
                [
                    options.id,
                    callback
                ]
            ])
        };
        bridges.set(source, bridge);
        try {
            source.subscribe(()=>{
                updateWave.begin();
                try {
                    for (const id of Array.from(bridge.subscribers.keys())){
                        var _bridge_subscribers_get;
                        null == (_bridge_subscribers_get = bridge.subscribers.get(id)) || _bridge_subscribers_get();
                    }
                } finally{
                    updateWave.end();
                }
            }, {
                id: bridge.id
            });
        } catch (error) {
            bridges.delete(source);
            try {
                source.unsubscribe(bridge.id);
            } catch  {}
            throw error;
        }
    },
    unsubscribe (source, id) {
        if ('read' in source || versions.has(source)) return void source.unsubscribe(id);
        const bridge = bridges.get(source);
        if (!bridge) return;
        bridge.subscribers.delete(id);
        if (0 === bridge.subscribers.size) {
            bridges.delete(source);
            source.unsubscribe(bridge.id);
        }
    }
};
export { computedDependencies };

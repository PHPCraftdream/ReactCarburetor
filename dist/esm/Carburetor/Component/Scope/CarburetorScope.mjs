import { diagnostics } from "../../Store/Diagnostics/DiagnosticsInstance.mjs";
import { IS_DEVELOPMENT } from "../../Store/Utils/DevelopmentFlag.mjs";
class CarburetorScope {
    instances = new Map();
    get = (token)=>{
        if (this.instances.has(token.id)) return this.instances.get(token.id);
        const created = token.create();
        this.instances.set(token.id, created);
        return created;
    };
    set = (token, instance)=>{
        this.instances.set(token.id, instance);
    };
    has = (token)=>this.instances.has(token.id);
    dehydrate = ()=>{
        const entries = [];
        this.instances.forEach((instance, id)=>{
            if (this.isInspectable(instance)) entries.push([
                id,
                instance.toJSON()
            ]);
        });
        return Object.fromEntries(entries);
    };
    hydrate = (state, tokens)=>{
        const claimed = new Set();
        tokens.forEach((token)=>{
            if (!Object.prototype.hasOwnProperty.call(state, token.id)) return;
            claimed.add(token.id);
            const instance = this.get(token);
            if (this.isInspectable(instance)) instance.fromJSON(state[token.id]);
        });
        if (IS_DEVELOPMENT) {
            const unclaimed = Object.keys(state).filter((key)=>!claimed.has(key));
            if (unclaimed.length > 0) diagnostics.report('hydrate() was handed state under keys no token claims: ' + unclaimed.map((key)=>'"' + key + '"').join(', ') + ". Those entries were ignored; if one of them looks like a token name, the server and the client declare that token under different names.");
        }
    };
    isInspectable = (instance)=>{
        if ('object' != typeof instance || null === instance) return false;
        const candidate = instance;
        return 'function' == typeof candidate.toJSON && 'function' == typeof candidate.fromJSON;
    };
}
export { CarburetorScope };

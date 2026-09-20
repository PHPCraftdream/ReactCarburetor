import { getUid } from "../Store/Utils/getUid.mjs";
import { WILDCARD_PATH } from "../Store/Paths/WildcardPath.mjs";
class Computed {
    body;
    uid = getUid();
    version = 0;
    subscribers = {};
    dependencies = {};
    value = void 0;
    valid = false;
    constructor(body){
        this.body = body;
    }
    getUID = ()=>this.uid;
    getVersion = ()=>this.version;
    get = ()=>{
        if (!this.valid) this.recompute();
        return this.value;
    };
    subscribe = (callback, options = {})=>{
        const id = options.id || getUid();
        const wasUnobserved = 0 === Object.keys(this.subscribers).length;
        this.subscribers[id] = callback;
        if (this.valid) {
            if (wasUnobserved) this.observeDependencies();
        } else this.recompute();
        return id;
    };
    unsubscribe = (id)=>{
        if (!(id in this.subscribers)) return;
        delete this.subscribers[id];
        if (0 === Object.keys(this.subscribers).length) {
            this.releaseDependencies();
            this.valid = false;
        }
    };
    recompute = ()=>{
        const collected = {};
        const track = (source)=>{
            const cuid = source.getUID();
            const dependency = collected[cuid] || {
                source,
                reads: new Set()
            };
            collected[cuid] = dependency;
            if ('read' in source) return source.read((path)=>{
                dependency.reads.add(path);
            });
            dependency.reads.add(WILDCARD_PATH);
            return source.get();
        };
        this.value = this.body(track);
        this.valid = true;
        this.attachDependencies(collected);
    };
    attachDependencies = (collected)=>{
        this.releaseDependencies();
        this.dependencies = collected;
        if (0 === Object.keys(this.subscribers).length) return;
        this.observeDependencies();
    };
    observeDependencies = ()=>{
        Object.keys(this.dependencies).forEach((cuid)=>{
            const dependency = this.dependencies[cuid];
            dependency.source.subscribe(this.onDependencyChanged, {
                id: this.uid,
                reads: dependency.reads
            });
        });
    };
    releaseDependencies = ()=>{
        Object.keys(this.dependencies).forEach((cuid)=>{
            this.dependencies[cuid].source.unsubscribe(this.uid);
        });
        this.dependencies = {};
    };
    onDependencyChanged = ()=>{
        const previous = this.value;
        this.valid = false;
        this.recompute();
        if (Object.is(previous, this.value)) return;
        this.version++;
        Object.keys(this.subscribers).forEach((id)=>{
            const callback = this.subscribers[id];
            if (callback) callback();
        });
    };
}
export { Computed };

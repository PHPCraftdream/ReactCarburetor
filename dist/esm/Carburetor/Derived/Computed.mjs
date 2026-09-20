import { getUid } from "../Store/getUid.mjs";
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
    subscribe = (callback, customId)=>{
        const id = customId || getUid();
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
        const read = (carburetor)=>{
            const cuid = carburetor.getUID();
            const dependency = collected[cuid] || {
                source: carburetor,
                reads: new Set()
            };
            collected[cuid] = dependency;
            return carburetor.read((path)=>{
                dependency.reads.add(path);
            });
        };
        this.value = this.body(read);
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
            dependency.source.subscribe(this.onDependencyChanged, this.uid, new Set(dependency.reads));
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

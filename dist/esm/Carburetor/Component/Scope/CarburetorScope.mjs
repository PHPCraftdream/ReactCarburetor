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
        const state = {};
        this.instances.forEach((instance, id)=>{
            if (this.isInspectable(instance)) state[id] = instance.toJSON();
        });
        return state;
    };
    hydrate = (state, tokens)=>{
        tokens.forEach((token)=>{
            if (!(token.id in state)) return;
            const instance = this.get(token);
            if (this.isInspectable(instance)) instance.fromJSON(state[token.id]);
        });
    };
    isInspectable = (instance)=>{
        if ('object' != typeof instance || null === instance) return false;
        const candidate = instance;
        return 'function' == typeof candidate.toJSON && 'function' == typeof candidate.fromJSON;
    };
}
export { CarburetorScope };

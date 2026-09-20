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
}
export { CarburetorScope };

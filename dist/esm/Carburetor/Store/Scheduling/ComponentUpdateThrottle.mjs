class ComponentUpdateThrottle {
    updateTimeout;
    maxUpdateDepth = 50;
    timeout = void 0;
    updaters = new Map();
    constructor(updateTimeout = 40){
        this.updateTimeout = updateTimeout;
    }
    schedule = (uid, updater)=>{
        this.updaters.set(uid, updater);
        this.setupTimeout();
    };
    cancel = (uid)=>{
        this.updaters.delete(uid);
    };
    setupTimeout = ()=>{
        if (!this.timeout) this.timeout = setTimeout(this.letsUpdate, this.updateTimeout);
    };
    clearTimeout = ()=>{
        if (this.timeout) clearTimeout(this.timeout);
        this.timeout = void 0;
    };
    runUpdater = (updater)=>{
        updater();
    };
    letsUpdate = ()=>{
        let depth = 0;
        while(this.updaters.size > 0){
            if (depth++ >= this.maxUpdateDepth) {
                this.updaters.clear();
                this.clearTimeout();
                throw new Error('ComponentUpdateThrottle: exceeded max update depth of ' + this.maxUpdateDepth + '. An updater keeps scheduling new updates — this is an infinite update loop.');
            }
            const batch = Array.from(this.updaters.values());
            this.updaters.clear();
            batch.forEach(this.runUpdater);
        }
        this.clearTimeout();
    };
}
export { ComponentUpdateThrottle };

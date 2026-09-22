import { diagnostics } from "../Diagnostics/DiagnosticsInstance.mjs";
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
        const failures = [];
        try {
            while(this.updaters.size > 0){
                if (depth++ >= this.maxUpdateDepth) {
                    this.updaters.clear();
                    throw new Error('ComponentUpdateThrottle: exceeded max update depth of ' + this.maxUpdateDepth + '. An updater keeps scheduling new updates — this is an infinite update loop.');
                }
                const batch = Array.from(this.updaters.values());
                this.updaters.clear();
                batch.forEach((updater)=>{
                    try {
                        this.runUpdater(updater);
                    } catch (error) {
                        failures.push(error);
                    }
                });
            }
        } finally{
            failures.forEach((error)=>{
                if ("u" > typeof process && 'production' !== process.env.NODE_ENV) diagnostics.report('an updater threw while the throttle flushed: ' + (error instanceof Error ? error.message : String(error)) + '. The remaining updaters in the batch were run anyway.');
            });
            this.clearTimeout();
        }
    };
}
export { ComponentUpdateThrottle };

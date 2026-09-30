import { diagnostics } from "../Diagnostics/DiagnosticsInstance.mjs";
class ComponentUpdateThrottle {
    updateTimeout;
    maxUpdateDepth = 50;
    timeout = void 0;
    updaters = new Map();
    flushing;
    spareUpdaters;
    flushFailures;
    enclosingFlushes;
    flushDepth = 0;
    flushNesting = 0;
    depthError;
    letsUpdateBound = ()=>this.letsUpdate();
    constructor(updateTimeout = 40){
        this.updateTimeout = updateTimeout;
    }
    schedule(uid, updater) {
        this.cancelActive(uid);
        this.updaters.set(uid, updater);
        this.setupTimeout();
    }
    cancel(uid) {
        this.cancelActive(uid);
        this.updaters.delete(uid);
    }
    cancelActive(uid) {
        var _this_flushing;
        null == (_this_flushing = this.flushing) || _this_flushing.delete(uid);
        const enclosing = this.enclosingFlushes;
        if (enclosing) for(let index = 0; index < enclosing.length; index++)enclosing[index].delete(uid);
    }
    setupTimeout() {
        if (!this.timeout) this.timeout = setTimeout(this.letsUpdateBound, this.updateTimeout);
    }
    clearTimeout() {
        if (this.timeout) clearTimeout(this.timeout);
        this.timeout = void 0;
    }
    runUpdater(updater) {
        updater();
    }
    runFlushingUpdater(updater) {
        try {
            this.runUpdater(updater);
        } catch (error) {
            if (error === this.depthError) throw error;
            (this.flushFailures ?? (this.flushFailures = [])).push(error);
        }
    }
    letsUpdate() {
        const enclosing = this.flushing;
        if (enclosing) (this.enclosingFlushes ?? (this.enclosingFlushes = [])).push(enclosing);
        this.flushNesting++;
        const previousFailures = this.flushFailures;
        this.flushFailures = void 0;
        try {
            while(this.updaters.size > 0){
                if (this.flushDepth++ >= this.maxUpdateDepth) {
                    var _this_flushing, _this_enclosingFlushes;
                    this.updaters.clear();
                    null == (_this_flushing = this.flushing) || _this_flushing.clear();
                    null == (_this_enclosingFlushes = this.enclosingFlushes) || _this_enclosingFlushes.forEach((batch)=>batch.clear());
                    throw this.depthError = new Error('ComponentUpdateThrottle: exceeded max update depth of ' + this.maxUpdateDepth + '. An updater keeps scheduling new updates — this is an infinite update loop.');
                }
                const batch = this.updaters;
                this.updaters = this.spareUpdaters ?? new Map();
                this.spareUpdaters = void 0;
                this.flushing = batch;
                batch.forEach(this.runFlushingUpdater, this);
                batch.clear();
                this.flushing = void 0;
                this.spareUpdaters = batch;
            }
        } finally{
            this.flushing = enclosing;
            if (enclosing) {
                var _this_enclosingFlushes1, _this_enclosingFlushes2;
                null == (_this_enclosingFlushes1 = this.enclosingFlushes) || _this_enclosingFlushes1.pop();
                if ((null == (_this_enclosingFlushes2 = this.enclosingFlushes) ? void 0 : _this_enclosingFlushes2.length) === 0) this.enclosingFlushes = void 0;
            }
            if (0 === --this.flushNesting) {
                this.flushDepth = 0;
                this.depthError = void 0;
            }
            const failures = this.flushFailures;
            this.flushFailures = previousFailures;
            null == failures || failures.forEach((error)=>{
                if ("u" > typeof process && 'production' !== process.env.NODE_ENV) diagnostics.report('an updater threw while the throttle flushed: ' + (error instanceof Error ? error.message : String(error)) + '. The remaining updaters in the batch were run anyway.');
            });
            this.clearTimeout();
        }
    }
}
export { ComponentUpdateThrottle };

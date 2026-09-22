import { diagnostics } from "../Diagnostics/DiagnosticsInstance.mjs";
class UpdateWave {
    depth = 0;
    pending = new Map();
    isActive = ()=>this.depth > 0;
    begin = ()=>{
        this.depth++;
    };
    end = ()=>{
        this.depth--;
        if (this.depth > 0) return;
        this.depth = 1;
        try {
            const failures = [];
            while(this.pending.size > 0){
                const batch = Array.from(this.pending.entries());
                this.pending.clear();
                batch.forEach(([, settle])=>{
                    try {
                        settle();
                    } catch (error) {
                        failures.push(error);
                    }
                });
            }
            failures.forEach((error)=>{
                if ("u" > typeof process && 'production' !== process.env.NODE_ENV) diagnostics.report('a computation threw while a wave was drained: ' + (error instanceof Error ? error.message : String(error)) + '. The remaining deferred computations were settled anyway.');
            });
        } finally{
            this.depth = 0;
        }
    };
    defer = (uid, settle)=>{
        this.pending.set(uid, settle);
    };
}
export { UpdateWave };

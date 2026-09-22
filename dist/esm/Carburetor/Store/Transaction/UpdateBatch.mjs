import { updateWave } from "../Scheduling/UpdateWaveInstance.mjs";
import { diagnostics } from "../Diagnostics/DiagnosticsInstance.mjs";
class UpdateBatch {
    depth = 0;
    pending = new Map();
    isActive = ()=>this.depth > 0;
    begin = ()=>{
        this.depth++;
    };
    end = ()=>{
        this.depth--;
        if (this.depth > 0) return;
        this.depth = 0;
        this.flush();
    };
    add = (target, writes)=>{
        const merged = this.pending.get(target);
        if (!merged) return void this.pending.set(target, new Set(writes));
        writes.forEach((path)=>merged.add(path));
    };
    flush = ()=>{
        updateWave.begin();
        try {
            const failures = [];
            while(this.pending.size > 0){
                const batch = Array.from(this.pending.entries());
                this.pending.clear();
                batch.forEach(([target, writes])=>{
                    try {
                        target.notifyWrites(writes);
                    } catch (error) {
                        failures.push(error);
                    }
                });
            }
            failures.forEach((error)=>{
                if ("u" > typeof process && 'production' !== process.env.NODE_ENV) diagnostics.report('a carburetor threw while a transaction was being delivered: ' + (error instanceof Error ? error.message : String(error)) + '. The other carburetors in the batch were notified anyway.');
            });
        } finally{
            updateWave.end();
        }
    };
}
export { UpdateBatch };

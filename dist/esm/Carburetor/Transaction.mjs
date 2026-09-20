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
        while(this.pending.size > 0){
            const batch = Array.from(this.pending.entries());
            this.pending.clear();
            batch.forEach(([target, writes])=>{
                target.notifyWrites(writes);
            });
        }
    };
}
const updateBatch = new UpdateBatch();
const transaction = (body)=>{
    updateBatch.begin();
    try {
        return body();
    } finally{
        updateBatch.end();
    }
};
export { UpdateBatch, transaction, updateBatch };

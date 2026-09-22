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
            while(this.pending.size > 0){
                const batch = Array.from(this.pending.entries());
                this.pending.clear();
                batch.forEach(([, settle])=>{
                    settle();
                });
            }
        } finally{
            this.depth = 0;
        }
    };
    defer = (uid, settle)=>{
        this.pending.set(uid, settle);
    };
}
export { UpdateWave };

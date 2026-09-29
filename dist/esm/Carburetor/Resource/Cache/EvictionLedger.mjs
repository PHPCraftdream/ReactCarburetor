class EvictionLedger {
    lastUsed = new Map();
    count = 0;
    walks = 0;
    useTick = 0;
    retainedAtCount = void 0;
    touch(key) {
        this.useTick += 1;
        this.lastUsed.delete(key);
        this.lastUsed.set(key, this.useTick);
    }
    create() {
        this.count += 1;
    }
    forget(key) {
        this.count -= 1;
        this.lastUsed.delete(key);
    }
    reset() {
        this.lastUsed.clear();
        this.count = 0;
        this.retainedAtCount = void 0;
    }
    replace(keys) {
        const live = new Set(keys);
        for (const key of this.lastUsed.keys())if (!live.has(key)) this.lastUsed.delete(key);
        keys.forEach((key)=>{
            if (!this.lastUsed.has(key)) this.touch(key);
        });
        this.count = keys.length;
        this.retainedAtCount = void 0;
    }
    release() {
        this.retainedAtCount = void 0;
    }
    shouldSkip(maxEntries) {
        if (this.count <= maxEntries) return true;
        if (void 0 === this.retainedAtCount) return false;
        const growthNeeded = Math.max(maxEntries, this.retainedAtCount);
        return this.count < this.retainedAtCount + growthNeeded;
    }
    selectVictims(maxEntries, isRetained) {
        const excess = this.count - maxEntries;
        const doomed = [];
        for (const key of this.lastUsed.keys()){
            if (doomed.length >= excess) break;
            this.walks += 1;
            if (!isRetained(key)) doomed.push(key);
        }
        this.retainedAtCount = doomed.length < excess ? this.count : void 0;
        this.count -= doomed.length;
        doomed.forEach((key)=>this.lastUsed.delete(key));
        return doomed;
    }
}
export { EvictionLedger };

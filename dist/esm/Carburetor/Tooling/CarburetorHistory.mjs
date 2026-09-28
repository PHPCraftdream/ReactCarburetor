import { PATCH_OPAQUE } from "../Models/Paths.mjs";
import { installPatch } from "../Store/Paths/Diff/installPatch.mjs";
import { deepClone } from "../Store/Utils/deepClone.mjs";
class CarburetorHistory {
    carburetor;
    past = [];
    future = [];
    baseline;
    limit;
    applying = false;
    dispose;
    pendingPatches = [];
    pendingOpaque = false;
    recordBound = ()=>this.record();
    onPatchBound = (patch)=>this.onPatch(patch);
    constructor(carburetor, options = {}){
        this.carburetor = carburetor;
        this.limit = options.limit || 50;
        this.baseline = carburetor.snapshot();
        const detachPatches = carburetor.attachPatchListener(this.onPatchBound);
        const subscriptionId = carburetor.subscribe(this.recordBound);
        this.dispose = ()=>{
            detachPatches();
            carburetor.unsubscribe(subscriptionId);
        };
    }
    canUndo() {
        return this.past.length > 0;
    }
    canRedo() {
        return this.future.length > 0;
    }
    undo() {
        const entry = this.past.pop();
        if (void 0 === entry) return false;
        this.future.push(entry);
        this.apply(entry, true);
        return true;
    }
    redo() {
        const entry = this.future.pop();
        if (void 0 === entry) return false;
        this.past.push(entry);
        this.apply(entry, false);
        return true;
    }
    clear() {
        this.past = [];
        this.future = [];
    }
    disconnect() {
        this.dispose();
    }
    onPatch(patch) {
        if (this.applying) return;
        if (patch === PATCH_OPAQUE) {
            this.pendingOpaque = true;
            return;
        }
        this.pendingPatches.push(patch);
    }
    record() {
        if (this.applying) return;
        this.past.push(this.buildEntry());
        if (this.past.length > this.limit) this.past.shift();
        this.future = [];
        this.pendingPatches = [];
        this.pendingOpaque = false;
    }
    buildEntry() {
        if (this.pendingOpaque || 0 === this.pendingPatches.length) {
            const before = this.baseline;
            const after = this.carburetor.snapshot();
            this.baseline = deepClone(after);
            return {
                kind: 'snapshot',
                before,
                after
            };
        }
        const patches = this.pendingPatches;
        for (const patch of patches)installPatch(this.baseline, patch, false);
        return {
            kind: 'patches',
            patches
        };
    }
    apply(entry, inverse) {
        this.applying = true;
        try {
            const state = 'snapshot' === entry.kind ? inverse ? entry.before : entry.after : this.reconstruct(entry.patches, inverse);
            this.carburetor.restore(state);
            this.baseline = 'snapshot' === entry.kind ? deepClone(state) : state;
        } finally{
            this.applying = false;
        }
    }
    reconstruct(patches, inverse) {
        const target = deepClone(this.baseline);
        const ordered = inverse ? [
            ...patches
        ].reverse() : patches;
        for (const patch of ordered)installPatch(target, patch, inverse);
        return target;
    }
}
export { CarburetorHistory };

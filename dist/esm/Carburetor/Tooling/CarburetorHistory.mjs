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
    skipReplay = false;
    replayTarget;
    ownedReplay = false;
    dispose;
    pendingPatches = [];
    pendingOpaque = false;
    observer = {
        patch: (patch)=>this.onPatch(patch),
        publication: ()=>this.record(),
        ownRestore: (state)=>{
            if (this.applying && state === this.replayTarget) this.ownedReplay = true;
        }
    };
    constructor(carburetor, options = {}){
        this.carburetor = carburetor;
        if (void 0 !== options.limit && (!Number.isSafeInteger(options.limit) || options.limit <= 0)) throw new RangeError('CarburetorHistory: limit must be a positive safe integer');
        this.limit = options.limit ?? 50;
        this.baseline = carburetor.snapshot();
        this.dispose = carburetor.attachPatchListener(this.observer);
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
        if (this.applying && this.ownedReplay) return;
        if (patch === PATCH_OPAQUE) {
            this.pendingOpaque = true;
            return;
        }
        this.pendingPatches.push(patch);
    }
    record() {
        if (this.applying) {
            this.applying = false;
            if (this.ownedReplay) {
                this.baseline = this.carburetor.snapshot();
                this.ownedReplay = false;
                this.skipReplay = false;
                return;
            }
            this.skipReplay = false;
        }
        if (this.skipReplay && !this.pendingOpaque && 0 === this.pendingPatches.length) {
            this.skipReplay = false;
            return;
        }
        this.skipReplay = false;
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
        const beforeVersion = this.carburetor.getVersion();
        this.applying = true;
        this.ownedReplay = false;
        this.skipReplay = true;
        try {
            const state = 'snapshot' === entry.kind ? inverse ? entry.before : entry.after : this.reconstruct(entry.patches, inverse);
            this.replayTarget = state;
            this.carburetor.restore(state);
            if (this.applying && this.ownedReplay) {
                this.baseline = this.carburetor.snapshot();
                this.skipReplay = this.carburetor.getVersion() !== beforeVersion;
            } else if (this.applying) this.skipReplay = false;
        } finally{
            this.replayTarget = void 0;
            this.ownedReplay = false;
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

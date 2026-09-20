import { WILDCARD_PATH } from "./Paths.mjs";
class CarburetorHistory {
    carburetor;
    past = [];
    future = [];
    current;
    limit;
    applying = false;
    dispose;
    constructor(carburetor, options = {}){
        this.carburetor = carburetor;
        this.limit = options.limit || 50;
        this.current = carburetor.snapshot();
        this.dispose = carburetor.watch(new Set([
            WILDCARD_PATH
        ]), this.record);
    }
    canUndo = ()=>this.past.length > 0;
    canRedo = ()=>this.future.length > 0;
    undo = ()=>{
        const previous = this.past.pop();
        if (void 0 === previous) return false;
        this.future.push(this.current);
        this.apply(previous);
        return true;
    };
    redo = ()=>{
        const next = this.future.pop();
        if (void 0 === next) return false;
        this.past.push(this.current);
        this.apply(next);
        return true;
    };
    clear = ()=>{
        this.past = [];
        this.future = [];
    };
    disconnect = ()=>{
        this.dispose();
    };
    record = ()=>{
        if (this.applying) return;
        this.past.push(this.current);
        if (this.past.length > this.limit) this.past.shift();
        this.future = [];
        this.current = this.carburetor.snapshot();
    };
    apply = (state)=>{
        this.applying = true;
        try {
            this.carburetor.restore(state);
            this.current = this.carburetor.snapshot();
        } finally{
            this.applying = false;
        }
    };
}
export { CarburetorHistory };

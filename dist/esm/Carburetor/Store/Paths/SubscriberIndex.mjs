import { PATH_SEPARATOR } from "./PathSeparator.mjs";
import { WILDCARD_PATH } from "./WildcardPath.mjs";
class SubscriberIndex {
    exact = new Map();
    branch = new Map();
    wildcard = new Set();
    readsById = new Map();
    add = (id, reads)=>{
        this.remove(id);
        this.readsById.set(id, reads);
        reads.forEach((readPath)=>{
            if (readPath === WILDCARD_PATH) return void this.wildcard.add(id);
            this.register(this.exact, readPath, id);
            this.eachAncestor(readPath, (ancestor)=>this.register(this.branch, ancestor, id));
        });
    };
    remove = (id)=>{
        const reads = this.readsById.get(id);
        if (!reads) return;
        this.readsById.delete(id);
        this.wildcard.delete(id);
        reads.forEach((readPath)=>{
            this.unregister(this.exact, readPath, id);
            this.eachAncestor(readPath, (ancestor)=>this.unregister(this.branch, ancestor, id));
        });
    };
    match = (writes)=>{
        if (writes.has(WILDCARD_PATH)) return new Set(this.readsById.keys());
        const matched = new Set(this.wildcard);
        writes.forEach((writePath)=>{
            this.collect(this.exact.get(writePath), matched);
            this.collect(this.branch.get(writePath), matched);
            this.eachAncestor(writePath, (ancestor)=>this.collect(this.exact.get(ancestor), matched));
        });
        return matched;
    };
    eachAncestor = (path, visit)=>{
        let cut = path.lastIndexOf(PATH_SEPARATOR);
        while(cut > 0){
            const ancestor = path.slice(0, cut);
            visit(ancestor);
            cut = ancestor.lastIndexOf(PATH_SEPARATOR);
        }
    };
    register = (target, path, id)=>{
        const known = target.get(path);
        if (known) return void known.add(id);
        target.set(path, new Set([
            id
        ]));
    };
    unregister = (target, path, id)=>{
        const known = target.get(path);
        if (!known) return;
        known.delete(id);
        if (0 === known.size) target.delete(path);
    };
    collect = (source, target)=>{
        if (!source) return;
        source.forEach((id)=>target.add(id));
    };
}
export { SubscriberIndex };

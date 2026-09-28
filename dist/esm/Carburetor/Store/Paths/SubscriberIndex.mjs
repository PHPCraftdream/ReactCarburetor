import { PATH_SEPARATOR } from "./PathSeparator.mjs";
import { WILDCARD_PATH } from "./WildcardPath.mjs";
class SubscriberIndex {
    exact = new Map();
    branch = new Map();
    wildcard = new Set();
    readsById = new Map();
    ancestorsById = new Map();
    add(id, reads) {
        this.remove(id);
        this.readsById.set(id, reads);
        const ancestors = new Map();
        this.ancestorsById.set(id, ancestors);
        reads.forEach((readPath)=>{
            if (readPath === WILDCARD_PATH) return void this.wildcard.add(id);
            this.file(id, readPath, ancestors);
        });
    }
    addPath(id, path) {
        const reads = this.readsById.get(id);
        if (!reads) return;
        reads.add(path);
        if (path === WILDCARD_PATH) return void this.wildcard.add(id);
        const exactReaders = this.exact.get(path);
        if (exactReaders && exactReaders.has(id)) return;
        let ancestors = this.ancestorsById.get(id);
        if (!ancestors) {
            ancestors = new Map();
            this.ancestorsById.set(id, ancestors);
        }
        this.file(id, path, ancestors);
    }
    remove(id) {
        const reads = this.readsById.get(id);
        if (!reads) return;
        const ancestors = this.ancestorsById.get(id);
        this.readsById.delete(id);
        this.ancestorsById.delete(id);
        this.wildcard.delete(id);
        reads.forEach((readPath)=>{
            this.unregister(this.exact, readPath, id);
            const chain = (null == ancestors ? void 0 : ancestors.get(readPath)) || this.ancestorsOf(readPath);
            chain.forEach((ancestor)=>this.unregister(this.branch, ancestor, id));
        });
    }
    match(writes) {
        if (writes.has(WILDCARD_PATH)) return new Set(this.readsById.keys());
        const matched = new Set(this.wildcard);
        writes.forEach((writePath)=>{
            this.collect(this.exact.get(writePath), matched);
            this.collect(this.branch.get(writePath), matched);
            this.ancestorsOf(writePath).forEach((ancestor)=>this.collect(this.exact.get(ancestor), matched));
        });
        return matched;
    }
    hasReaderAt(path) {
        return this.exact.has(path) || this.branch.has(path);
    }
    file(id, path, ancestors) {
        this.register(this.exact, path, id);
        const chain = this.ancestorsOf(path);
        ancestors.set(path, chain);
        chain.forEach((ancestor)=>this.register(this.branch, ancestor, id));
    }
    ancestorsOf(path) {
        const chain = [];
        let cut = path.lastIndexOf(PATH_SEPARATOR);
        while(cut > 0){
            const ancestor = path.slice(0, cut);
            chain.push(ancestor);
            cut = ancestor.lastIndexOf(PATH_SEPARATOR);
        }
        return chain;
    }
    register(target, path, id) {
        const known = target.get(path);
        if (known) return void known.add(id);
        target.set(path, new Set([
            id
        ]));
    }
    unregister(target, path, id) {
        const known = target.get(path);
        if (!known) return;
        known.delete(id);
        if (0 === known.size) target.delete(path);
    }
    collect(source, target) {
        if (!source) return;
        source.forEach((id)=>target.add(id));
    }
}
export { SubscriberIndex };

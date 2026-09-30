import { PATH_SEPARATOR } from "./PathSeparator.mjs";
import { WILDCARD_PATH } from "./WildcardPath.mjs";
class SubscriberIndex {
    exact = new Map();
    branch = new Map();
    wildcard = new Set();
    readsById = new Map();
    add(id, reads) {
        const previous = this.readsById.get(id);
        if (previous === reads) return;
        this.readsById.set(id, reads);
        if (void 0 === previous) return void this.registerFresh(id, reads);
        previous.forEach((path)=>{
            if (path !== WILDCARD_PATH && !reads.has(path)) this.unfile(id, path);
        });
        reads.forEach((path)=>{
            if (path !== WILDCARD_PATH && !previous.has(path)) this.file(id, path);
        });
        if (reads.has(WILDCARD_PATH)) this.wildcard.add(id);
        else this.wildcard.delete(id);
    }
    addPath(id, path) {
        const reads = this.readsById.get(id);
        if (!reads) return;
        if (path === WILDCARD_PATH) {
            reads.add(path);
            this.wildcard.add(id);
            return;
        }
        const alreadyFiled = this.isFiledAt(path, id);
        reads.add(path);
        if (!alreadyFiled) this.file(id, path);
    }
    remove(id) {
        const reads = this.readsById.get(id);
        if (!reads) return;
        this.readsById.delete(id);
        this.wildcard.delete(id);
        reads.forEach((path)=>{
            if (path !== WILDCARD_PATH) this.unfile(id, path);
        });
    }
    match(writes) {
        if (writes.has(WILDCARD_PATH)) return new Set(this.readsById.keys());
        const matched = this.wildcard.size > 0 ? new Set(this.wildcard) : new Set();
        for (const writePath of writes){
            this.collect(this.exact.get(writePath), matched);
            this.collect(this.branch.get(writePath), matched);
            let cut = writePath.lastIndexOf(PATH_SEPARATOR);
            while(cut > 0){
                this.collect(this.exact.get(writePath.slice(0, cut)), matched);
                cut = writePath.lastIndexOf(PATH_SEPARATOR, cut - 1);
            }
        }
        return matched;
    }
    hasReaderAt(path) {
        return this.exact.has(path) || this.branch.has(path);
    }
    registerFresh(id, reads) {
        reads.forEach((path)=>{
            if (path === WILDCARD_PATH) return void this.wildcard.add(id);
            this.file(id, path);
        });
    }
    isFiledAt(path, id) {
        const bucket = this.exact.get(path);
        return bucket === id || void 0 !== bucket && 'string' != typeof bucket && bucket.has(id);
    }
    file(id, path) {
        this.register(this.exact, path, id);
        this.ancestorsOf(path).forEach((ancestor)=>this.registerBranch(ancestor, id));
    }
    unfile(id, path) {
        this.unregister(this.exact, path, id);
        this.ancestorsOf(path).forEach((ancestor)=>this.unregisterBranch(ancestor, id));
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
        if (void 0 === known) return void target.set(path, id);
        if ('string' == typeof known) {
            if (known === id) return;
            target.set(path, new Set([
                known,
                id
            ]));
            return;
        }
        known.add(id);
    }
    unregister(target, path, id) {
        const known = target.get(path);
        if (void 0 === known) return;
        if ('string' == typeof known) {
            if (known === id) target.delete(path);
            return;
        }
        known.delete(id);
        if (1 === known.size) {
            const [remaining] = known;
            target.set(path, remaining);
        }
    }
    registerBranch(path, id) {
        const known = this.branch.get(path);
        if (void 0 === known) this.branch.set(path, id);
        else if ('string' == typeof known) this.branch.set(path, known === id ? {
            id,
            count: 2
        } : new Map([
            [
                known,
                1
            ],
            [
                id,
                1
            ]
        ]));
        else if (known instanceof Map) known.set(id, (known.get(id) ?? 0) + 1);
        else if (known.id === id) known.count++;
        else this.branch.set(path, new Map([
            [
                known.id,
                known.count
            ],
            [
                id,
                1
            ]
        ]));
    }
    unregisterBranch(path, id) {
        const known = this.branch.get(path);
        if (void 0 === known) return;
        if ('string' == typeof known) {
            if (known === id) this.branch.delete(path);
            return;
        }
        if (known instanceof Map) {
            const count = known.get(id);
            if (void 0 === count) return;
            if (count > 1) known.set(id, count - 1);
            else {
                known.delete(id);
                if (1 === known.size) {
                    const [remainingId, remainingCount] = known.entries().next().value;
                    this.branch.set(path, 1 === remainingCount ? remainingId : {
                        id: remainingId,
                        count: remainingCount
                    });
                }
            }
            return;
        }
        if (known.id === id) if (2 === known.count) this.branch.set(path, id);
        else known.count--;
    }
    collect(source, target) {
        if (void 0 === source) return;
        if ('string' == typeof source) return void target.add(source);
        if (source instanceof Set) source.forEach((id)=>target.add(id));
        else if (source instanceof Map) source.forEach((_count, id)=>target.add(id));
        else target.add(source.id);
    }
}
export { SubscriberIndex };

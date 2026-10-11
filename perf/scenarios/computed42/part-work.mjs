const pair = value => value !== null && typeof value === 'object'
    && typeof value.version === 'number' && value.reads instanceof Set && !Object.hasOwn(value, 'source');
const references = array => {
    let count = 0;
    for (let index = 0; index < array.length; index++) if (pair(array[index])) count++;
    return count;
};

/**
 * Measures part-reference work to expose fan-in copying, not elapsed time or allocations.
 *
 * Only synchronous use of the wrapped Array methods and shape-matching pairs is counted;
 * direct indexing is invisible, and copy counts are proxies rather than exact memory traffic.
 * Global Array methods are restored when the body returns or throws.
 */
export const countPartWork = body => {
    const original = new Map();
    const work = {iteratorRefs: 0, copyRefs: 0, appendRefs: 0};
    let nested = 0;
    const install = (holder, key, replacement) => {
        const descriptor = Object.getOwnPropertyDescriptor(holder, key);
        original.set(replacement, {holder, key, descriptor});
        Object.defineProperty(holder, key, {...descriptor, value: replacement});
    };
    const iterator = Array.prototype[Symbol.iterator];
    install(Array.prototype, Symbol.iterator, function() {
        const inner = iterator.call(this);
        return {
            next() {
                const item = inner.next();
                if (!nested && !item.done && pair(item.value)) work.iteratorRefs++;
                return item;
            },
            [Symbol.iterator]() { return this; },
        };
    });
    for (const name of ['push', 'unshift']) {
        const method = Array.prototype[name];
        install(Array.prototype, name, function(...args) {
            if (!nested) work.appendRefs += references(args);
            return Reflect.apply(method, this, args);
        });
    }
    for (const name of ['slice', 'concat', 'map', 'filter', 'flat', 'flatMap',
        'toSpliced', 'toReversed', 'toSorted', 'with']) {
        const method = Array.prototype[name];
        if (!method) continue;
        install(Array.prototype, name, function(...args) {
            const outer = nested++ === 0;
            let result;
            try { result = Reflect.apply(method, this, args); } finally { nested--; }
            if (outer) work.copyRefs += references(result);
            return result;
        });
    }
    for (const name of ['from', 'of']) {
        const method = Array[name];
        install(Array, name, function(...args) {
            const outer = nested++ === 0;
            let result;
            try { result = Reflect.apply(method, this, args); } finally { nested--; }
            if (outer) work.copyRefs += references(result);
            return result;
        });
    }
    const splice = Array.prototype.splice;
    install(Array.prototype, 'splice', function(...args) {
        const before = references(this);
        const result = Reflect.apply(splice, this, args);
        if (!nested) {
            work.copyRefs += before + references(result);
            for (let index = 2; index < args.length; index++) if (pair(args[index])) work.appendRefs++;
        }
        return result;
    });
    const copyWithin = Array.prototype.copyWithin;
    install(Array.prototype, 'copyWithin', function(...args) {
        const result = Reflect.apply(copyWithin, this, args);
        if (!nested) work.copyRefs += references(result);
        return result;
    });
    try { work.value = body(); } finally {
        for (const saved of original.values()) Object.defineProperty(saved.holder, saved.key, saved.descriptor);
    }
    work.partRefs = work.iteratorRefs + work.copyRefs + work.appendRefs;
    return work;
};

/**
 * Checks empty and known Array operations so a silent counter cannot pass the perf gate.
 * These synthetic controls validate wrapped-method coverage, not arbitrary copying code.
 */
export const counterControls = () => {
    const parts = [{version: 0, reads: new Set(['a'])}, {version: 0, reads: new Set(['b'])}];
    const empty = countPartWork(() => 0);
    const spread = countPartWork(() => [...parts]);
    const append = countPartWork(() => { const output = []; output.push(parts[0], parts[1]); });
    const copy = countPartWork(() => parts.slice());
    const methods = ['concat', 'map', 'filter', 'flat', 'flatMap', 'toSpliced', 'toReversed', 'toSorted', 'with'];
    const covered = methods.every(name => {
        const args = name === 'map' || name === 'flatMap' ? [value => value]
            : name === 'filter' ? [() => true] : name === 'with' ? [0, parts[0]] : [];
        return countPartWork(() => Reflect.apply(Array.prototype[name], parts, args)).partRefs === 2;
    }) && countPartWork(() => Array.from(parts)).partRefs === 2
        && countPartWork(() => Array.of(parts[0], parts[1])).partRefs === 2
        && countPartWork(() => { const output = []; output.unshift(parts[0], parts[1]); }).partRefs === 2
        && countPartWork(() => parts.slice().copyWithin(0, 1)).partRefs >= 2
        && countPartWork(() => parts.slice().splice(0, 1, parts[1])).partRefs >= 2;
    return {empty: empty.partRefs, spread: spread.partRefs, append: append.partRefs, copy: copy.partRefs, covered};
};

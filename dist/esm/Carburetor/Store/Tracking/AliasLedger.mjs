import { joinPath } from "../Paths/joinPath.mjs";
import { diagnostics } from "../Diagnostics/DiagnosticsInstance.mjs";
import { isTrackable } from "./isTrackable.mjs";
const isArrayIndexKey = (key)=>'0' === key || /^[1-9]\d*$/.test(key) && Number(key) <= 0xFFFFFFFE;
const throwNonIndexKey = (value, path)=>{
    for (const name of Object.getOwnPropertyNames(value))if ('length' !== name && !isArrayIndexKey(name)) throw new Error('Carburetor: array at "' + (path || 'the root') + '" has a non-index own key "' + name + '" — an array\'s state is its elements and length only.');
    throw new Error('Carburetor: array at "' + (path || 'the root') + '" has an unexpected own key.');
};
const checkDescriptor = (descriptor, childPath)=>{
    if ('get' in descriptor || 'set' in descriptor) throw new Error('Carburetor: "' + childPath() + '" is an accessor property (getter/setter) — state is plain data only. Derive it instead, e.g. with Computed.');
    if (!descriptor.enumerable) throw new Error('Carburetor: "' + childPath() + '" is a non-enumerable own property — state must be enumerable: Object.keys() is what diffing, cloning and restoring see.');
};
const checkArray = (value, path, previous, stack)=>{
    const priorArray = Array.isArray(previous) ? previous : void 0;
    if (value.length <= 4096) {
        let ownIndexCount = 0;
        for(let index = 0; index < value.length; index++){
            if (!Object.prototype.hasOwnProperty.call(value, index)) continue;
            ownIndexCount++;
            const name = String(index);
            const descriptor = Reflect.getOwnPropertyDescriptor(value, name);
            checkDescriptor(descriptor, ()=>joinPath(path, name));
            const previousElement = priorArray ? priorArray[index] : void 0;
            if (!Object.is(descriptor.value, previousElement) && isTrackable(descriptor.value)) checkContainer(descriptor.value, joinPath(path, name), previousElement, stack);
        }
        if (Object.getOwnPropertyNames(value).length !== ownIndexCount + 1) throwNonIndexKey(value, path);
        return;
    }
    for (const name of Object.getOwnPropertyNames(value)){
        if ('length' === name) continue;
        if (!isArrayIndexKey(name)) throwNonIndexKey(value, path);
        const descriptor = Reflect.getOwnPropertyDescriptor(value, name);
        checkDescriptor(descriptor, ()=>joinPath(path, name));
        const previousElement = priorArray ? priorArray[Number(name)] : void 0;
        if (!Object.is(descriptor.value, previousElement) && isTrackable(descriptor.value)) checkContainer(descriptor.value, joinPath(path, name), previousElement, stack);
    }
};
const checkObject = (value, path, previous, stack)=>{
    const priorObject = isTrackable(previous) && !Array.isArray(previous) ? previous : void 0;
    for (const name of Object.getOwnPropertyNames(value)){
        const descriptor = Reflect.getOwnPropertyDescriptor(value, name);
        checkDescriptor(descriptor, ()=>joinPath(path, name));
        const previousField = priorObject ? priorObject[name] : void 0;
        if (!Object.is(descriptor.value, previousField) && isTrackable(descriptor.value)) checkContainer(descriptor.value, joinPath(path, name), previousField, stack);
    }
};
const checkContainer = (value, path, previous, stack)=>{
    if (stack.has(value)) throw new Error('Carburetor: state at "' + (path || 'the root') + '" is cyclic — a container cannot contain itself.');
    if (Object.getOwnPropertySymbols(value).length > 0) throw new Error('Carburetor: state at "' + (path || 'the root') + '" has an own symbol key, which is not part of the state model — use a string key instead.');
    stack.add(value);
    try {
        if (Array.isArray(value)) checkArray(value, path, previous, stack);
        else checkObject(value, path, previous, stack);
    } finally{
        stack.delete(value);
    }
};
const checkStateWalk = (value, path, previous, stack)=>{
    if (Object.is(value, previous)) return;
    if (!isTrackable(value)) return;
    checkContainer(value, path, previous, stack ?? new Set());
};
const createAliasLedger = ()=>{
    if ("u" < typeof process || 'production' === process.env.NODE_ENV) return;
    const seen = new WeakMap();
    return {
        note: (value, path)=>{
            const found = seen.get(value);
            if (void 0 !== found && found !== path) diagnostics.report('the same object was reached at two paths, ' + found + ' and ' + path + ": reads are tracked by path, so a write through one will not wake a component reading the other. Keep the data a tree — one object, one path.");
            seen.set(value, path);
        },
        checkWrite: (source, path)=>{
            const found = seen.get(source);
            if (void 0 !== found && found !== path) diagnostics.report('a write landed in an object that was also read at ' + found + ", while the write sits at " + (path || 'the root') + ": only the written path is woken, the other never hears about it. Keep the data a tree — one object, one path.");
        },
        forget: (value)=>{
            if (null !== value && 'object' == typeof value) seen.delete(value);
        },
        checkState: (value, path, previous)=>{
            checkStateWalk(value, path, previous, void 0);
        },
        checkKey: (container, key, path)=>{
            if (Array.isArray(container) && 'length' !== key && !isArrayIndexKey(key)) throw new Error('Carburetor: "' + path + '" is not an index or "length" — an array\'s state is its elements and length only.');
        }
    };
};
export { createAliasLedger };

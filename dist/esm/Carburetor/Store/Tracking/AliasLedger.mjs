import { diagnostics } from "../Diagnostics/DiagnosticsInstance.mjs";
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
        }
    };
};
export { createAliasLedger };

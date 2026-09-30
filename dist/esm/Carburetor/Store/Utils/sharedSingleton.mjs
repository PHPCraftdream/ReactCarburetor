import { diagnostics } from "../Diagnostics/DiagnosticsInstance.mjs";
const copyMarker = {};
const sharedSingleton = (name, create, react)=>{
    const registry = globalThis;
    const key = Symbol.for(`react-carburetor/v1/${name}`);
    const existing = registry[key];
    if (existing) {
        const foreignCopy = existing.copy !== copyMarker;
        const foreignReact = void 0 !== react && existing.react !== react;
        if ("u" > typeof process && 'production' !== process.env.NODE_ENV && (foreignCopy || foreignReact) && !existing.reported) {
            existing.reported = true;
            diagnostics.report(`two copies of react-carburetor share this process for "${name}" — a duplicated install, or the package loaded through two different module formats at once. Dedupe the install, or make sure only one module format is loaded.` + (foreignReact ? ' The copies also imported different React modules — align them to one React install.' : ''));
        }
        return existing.value;
    }
    const created = {
        value: create(),
        copy: copyMarker,
        react,
        reported: false
    };
    registry[key] = created;
    return created.value;
};
export { sharedSingleton };

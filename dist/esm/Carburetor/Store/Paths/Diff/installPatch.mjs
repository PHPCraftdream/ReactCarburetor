import { isTrackable } from "../../Tracking/isTrackable.mjs";
import { deepClone } from "../../Utils/deepClone.mjs";
const installPatch = (root, patch, inverse)=>{
    let node = root;
    for(let i = 0; i < patch.segments.length - 1; i++){
        const segment = patch.segments[i];
        if (!Object.prototype.hasOwnProperty.call(node, segment)) throw new Error('Carburetor: patch path is missing an own segment');
        node = node[segment];
    }
    const key = patch.segments[patch.segments.length - 1];
    const value = inverse ? patch.previous : patch.next;
    if (inverse ? patch.previousExists : patch.nextExists) if ('__proto__' === key) Object.defineProperty(node, key, {
        value: isTrackable(value) ? deepClone(value) : value,
        writable: true,
        enumerable: true,
        configurable: true
    });
    else node[key] = isTrackable(value) ? deepClone(value) : value;
    else delete node[key];
};
export { installPatch };

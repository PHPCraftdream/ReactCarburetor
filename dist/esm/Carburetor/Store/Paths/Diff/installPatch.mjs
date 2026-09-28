import { PATCH_ABSENT } from "../../../Models/Paths.mjs";
import { isTrackable } from "../../Tracking/isTrackable.mjs";
import { deepClone } from "../../Utils/deepClone.mjs";
const installPatch = (root, patch, inverse)=>{
    let node = root;
    for(let i = 0; i < patch.segments.length - 1; i++)node = node[patch.segments[i]];
    const key = patch.segments[patch.segments.length - 1];
    const value = inverse ? patch.previous : patch.next;
    if (value === PATCH_ABSENT) delete node[key];
    else node[key] = isTrackable(value) ? deepClone(value) : value;
};
export { installPatch };

import { detachOpaque } from "./detachOpaque.mjs";
const detachWatchSelection = (value)=>{
    if (null === value || 'object' != typeof value) return value;
    return detachOpaque(value, (instance)=>{
        var _Object_getPrototypeOf_constructor, _Object_getPrototypeOf;
        throw new Error('watch() cannot select a live ' + ((null == (_Object_getPrototypeOf = Object.getPrototypeOf(instance)) ? void 0 : null == (_Object_getPrototypeOf_constructor = _Object_getPrototypeOf.constructor) ? void 0 : _Object_getPrototypeOf_constructor.name) || 'class') + " instance because in-place changes cannot produce a safe comparison. Select the fields the callback needs, or return a plain object of those fields.");
    });
};
export { detachWatchSelection };

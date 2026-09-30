import { detachOpaque } from "../../Store/Utils/Selection/detachOpaque.mjs";
const rejectArraySubclass = (value)=>{
    var _Object_getPrototypeOf;
    const ctor = null == (_Object_getPrototypeOf = Object.getPrototypeOf(value)) ? void 0 : _Object_getPrototypeOf.constructor;
    const name = 'function' == typeof ctor && ctor.name ? ctor.name : 'an anonymous class';
    throw new Error('detachSelection() cannot snapshot an Array subclass (' + name + '): copying it would forge an "instanceof ' + name + '" object whose constructor never ran and whose private fields were never installed. Select a plain array (for example Array.from(value)) or project the fields the child needs instead.');
};
const detachSelection = (value)=>detachOpaque(value, void 0, rejectArraySubclass);
export { detachSelection };

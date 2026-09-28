import { containsExoticValue } from "../Store/Utils/containsExoticValue.mjs";
const announceIsUnchanged = (announced, previous, next, dependenciesMoved, equals)=>{
    const baseline = void 0 !== announced ? announced.value : previous;
    const sameReference = Object.is(baseline, next);
    const opaqueChanged = sameReference && dependenciesMoved && containsExoticValue(next);
    const contentSame = !sameReference && void 0 !== announced && void 0 !== equals && equals(announced.value, next);
    return sameReference && !opaqueChanged || contentSame;
};
export { announceIsUnchanged };

import { isTrackable } from "../../Tracking/isTrackable.mjs";
import { deepClone } from "../../Utils/deepClone.mjs";
import { DIFF_PATH_THRESHOLD } from "./DiffThreshold.mjs";
import { hasSymbolDifference } from "./hasSymbolDifference.mjs";
import { sameKind } from "./sameKind.mjs";
class ApplyDiffOverflow extends Error {
}
const spend = (budget)=>{
    budget.spent++;
    if (budget.spent > DIFF_PATH_THRESHOLD) throw new ApplyDiffOverflow();
};
const applyDiff_assign = (target, key, value)=>{
    if ('__proto__' === key) return void Object.defineProperty(target, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true
    });
    target[key] = value;
};
const applyKey = (target, key, previous, next, budget)=>{
    if (Object.is(previous, next)) return;
    if (isTrackable(previous) && isTrackable(next) && sameKind(previous, next) && !hasSymbolDifference(previous, next)) return void applyBranch(target[key], previous, next, budget);
    spend(budget);
    applyDiff_assign(target, key, deepClone(next));
};
const applyBranch = (target, previous, next, budget)=>{
    const previousLength = previous.length;
    const nextLength = next.length;
    if (Array.isArray(previous) && nextLength < previousLength) {
        spend(budget);
        target.length = nextLength;
    }
    const previousKeys = Object.keys(previous);
    const nextKeys = Object.keys(next);
    const seen = new Set();
    for (const key of previousKeys){
        seen.add(key);
        if (!Object.prototype.hasOwnProperty.call(next, key)) {
            spend(budget);
            delete target[key];
            continue;
        }
        applyKey(target, key, previous[key], next[key], budget);
    }
    for (const key of nextKeys)if (!seen.has(key)) {
        spend(budget);
        applyDiff_assign(target, key, deepClone(next[key]));
    }
};
const applyDiff = (target, previous, next)=>{
    try {
        applyBranch(target, previous, next, {
            spent: 0
        });
    } catch (error) {
        if (error instanceof ApplyDiffOverflow) return false;
        throw error;
    }
    return true;
};
export { applyDiff };

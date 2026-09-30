import { sharedSingleton } from "../Utils/sharedSingleton.mjs";
const knownViews = sharedSingleton('liveViews', ()=>new WeakMap());
const liveViews = {
    note: (view)=>{
        if (!knownViews.has(view)) knownViews.set(view, void 0);
    },
    noteReadTarget: (view, target)=>{
        knownViews.set(view, target);
    },
    noteDynamicReadTarget: (view, resolve)=>{
        knownViews.set(view, resolve);
    },
    readTarget: (view)=>{
        const known = knownViews.get(view);
        return 'function' == typeof known ? known() : known;
    },
    has: (value)=>'object' == typeof value && null !== value && knownViews.has(value)
};
export { liveViews };

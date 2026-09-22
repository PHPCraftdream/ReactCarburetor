const knownViews = new WeakSet();
const liveViews = {
    note: (view)=>{
        knownViews.add(view);
    },
    has: (value)=>'object' == typeof value && null !== value && knownViews.has(value)
};
export { liveViews };

import { isTrackable } from "../../Store/Tracking/isTrackable.mjs";
const buildTrackedView = (views, carburetor, getRenderAttempt, attempt, entry)=>{
    const data = carburetor.getData();
    if (!isTrackable(data)) return carburetor.read((path)=>{
        if (void 0 !== attempt) entry.reads.add(path);
    });
    const cached = views.get(carburetor);
    if (void 0 !== cached && cached.data === data) {
        cached.attempt = attempt;
        cached.entry = entry;
        return cached.view;
    }
    const tracked = {
        data,
        view: void 0,
        attempt,
        entry
    };
    tracked.view = carburetor.read((path)=>{
        if (void 0 !== tracked.attempt && getRenderAttempt() === tracked.attempt) tracked.entry.reads.add(path);
    });
    views.set(carburetor, tracked);
    return tracked.view;
};
export { buildTrackedView };

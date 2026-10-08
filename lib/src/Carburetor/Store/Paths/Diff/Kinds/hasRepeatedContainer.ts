import {isTrackable} from '@/Carburetor/Store/Tracking/isTrackable';
import {liveViews} from '@/Carburetor/Store/Tracking/Proxy/liveViews';

/** R39-05: independent index clones cannot preserve a repeated container or cycle. */
export const hasRepeatedContainer = (value: unknown): boolean => {
    const seen = new Set<object>();
    const visit = (candidate: unknown): boolean => {
        if (candidate !== null && typeof candidate === 'object') {
            candidate = liveViews.readTarget(candidate) ?? candidate;
        }
        if (!isTrackable(candidate)) return false;
        if (seen.has(candidate)) return true;
        seen.add(candidate);
        for (const key of Object.keys(candidate)) {
            if (visit((candidate as Record<string, unknown>)[key])) return true;
        }
        return false;
    };
    return visit(value);
};

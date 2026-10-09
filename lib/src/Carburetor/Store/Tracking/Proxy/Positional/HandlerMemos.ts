import {TPath} from '@/Carburetor/Models/Paths';

/** Lazy per-branch path memos; enumeration-only wrappers allocate none. */
export class HandlerMemos {
    /** First child key resolved by this branch. */
    public firstKey: string | undefined = undefined;
    /** Path cached for the first child key. */
    public firstPath: TPath = '';
    /** Additional child paths, allocated on demand. */
    public childPaths: Map<string, TPath> | undefined = undefined;
    /** First branch path whose marker was resolved. */
    public firstBranch: TPath | undefined = undefined;
    /** Marker cached for the first branch path. */
    public firstMarker: TPath = '';
    /** Additional branch markers, allocated on demand. */
    public branchMarkers: Map<TPath, TPath> | undefined = undefined;
    /** Enumeration marker for this branch. */
    public keysMarkerPath: TPath | undefined = undefined;
}

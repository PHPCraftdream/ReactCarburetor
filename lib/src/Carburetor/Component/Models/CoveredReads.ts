import {TPath} from "../../Models/Paths";
import {readCoverage} from "../../Store/Paths/Markers/readCoverage";
import {TCompletedReads} from "../../Store/Tracking/Observation/Models";

/**
 * The read set a selection records into while its snapshot is being reused: every path still goes
 * to the attempt's own set, but a path the committed set already covers is kept out of this one.
 *
 * A reuse that is rejected falls back to the attempt's own set, so nothing a read touched is lost
 * to the coverage of somebody else's set; a reuse that holds ends up sharing the committed set.
 */
export class CoveredReads extends Set<TPath> {
    /**
     * Copies the starting paths without recording them again.
     *
     * @param paths - the paths this set starts with
     * @param own - the attempt's own set, which every later path is recorded into
     * @param filed - the committed set whose coverage keeps a path out of this one
     */
    public constructor(
        paths: Iterable<TPath>,
        private readonly own: Set<TPath>,
        private readonly filed: TCompletedReads
    ) {
        super();
        for (const path of paths) super.add(path);
    }

    /**
     * Records the path into the attempt's own set, and into this one unless it is covered.
     *
     * @param path - the path a read touched
     */
    public override add(path: TPath): this {
        this.own.add(path);
        if (!readCoverage.covers(this.filed, path)) super.add(path);

        return this;
    }
}

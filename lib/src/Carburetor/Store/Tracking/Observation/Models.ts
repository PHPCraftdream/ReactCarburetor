import {TPath, TPathSet} from "@/Carburetor/Models/Paths";

declare const COMPLETED_READS: unique symbol;

/** Read paths whose selector/render collection phase has finished. */
export type TCompletedReads = ReadonlySet<TPath> & {readonly [COMPLETED_READS]: true};

/** A selected value coupled to the read set closed by its comparison and detachment work. */
export type TCompletedObservation<T extends {value: unknown; reads: TPathSet}> =
    Omit<T, "reads"> & {readonly reads: TCompletedReads};

import {detachOpaque} from "@/Carburetor/Store/Utils/Selection/detachOpaque";
import {rejectArraySubclass} from "@/Carburetor/Store/Utils/Selection/rejectArraySubclass";

/**
 * The detached form of a selection, sharing the tracked-view/raw-target graph ledger with
 * watch and hook selections.
 *
 * A selection is plain data in the state-model sense (R30-04): own enumerable string keys,
 * array elements and `length`, detached copies of plain Date/Map/Set; symbol keys,
 * non-enumerable keys and descriptor flags are not part of a selection and are not copied.
 *
 * Ordinary class instances still pass through live; Array subclasses remain rejected.
 *
 * @param value - the candidate to detach
 */
export const detachSelection = (value: unknown): unknown =>
    detachOpaque(value, undefined, rejectArraySubclass);

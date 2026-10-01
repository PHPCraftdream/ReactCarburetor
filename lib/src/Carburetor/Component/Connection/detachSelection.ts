import {detachOpaque} from "@/Carburetor/Store/Utils/Selection/detachOpaque";

/**
 * Refuses to forge an Array subclass without running its constructor (including private fields).
 *
 * @param value - the Array subclass encountered during detachment
 */
const rejectArraySubclass = (value: object): never => {
    const ctor: unknown = (Object.getPrototypeOf(value) as {constructor?: unknown} | null)?.constructor;
    const name = typeof ctor === 'function' && ctor.name ? ctor.name : 'an anonymous class';

    throw new Error(
        'detachSelection() cannot snapshot an Array subclass (' + name + '): copying it would forge ' +
        'an "instanceof ' + name + '" object whose constructor never ran and whose private fields ' +
        'were never installed. Select a plain array (for example Array.from(value)) or project the ' +
        'fields the child needs instead.'
    );
};

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

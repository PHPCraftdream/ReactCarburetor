/**
 * Refuses to forge an Array subclass without running its constructor (including private fields).
 *
 * @param value - the Array subclass encountered during detachment
 */
export const rejectArraySubclass = (value: object): never => {
    const ctor: unknown = (Object.getPrototypeOf(value) as {constructor?: unknown} | null)?.constructor;
    const name = typeof ctor === 'function' && ctor.name ? ctor.name : 'an anonymous class';

    throw new Error(
        'detachSelection() cannot snapshot an Array subclass (' + name + '): copying it would forge ' +
        'an "instanceof ' + name + '" object whose constructor never ran and whose private fields ' +
        'were never installed. Select a plain array (for example Array.from(value)) or project the ' +
        'fields the child needs instead.'
    );
};

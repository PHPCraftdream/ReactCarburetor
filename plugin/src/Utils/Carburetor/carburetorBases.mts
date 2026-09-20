/**
 * The base classes a rule recognises a store by.
 *
 * As with component bases, a project-local subclass is invisible without type information, so a
 * project that layers its own base on top adds it through the `carburetorBases` option.
 */
export const CARBURETOR_BASES: readonly string[] = ['Carburetor', 'ResourceCarburetor'];

/**
 * The base classes a rule recognises a carburetor component by.
 *
 * Extending this list is how a project with its own base class opts in, since a JS plugin gets
 * no type information and cannot discover that `ProjectComponent extends AntiHookComponent`.
 */
export const COMPONENT_BASES: readonly string[] = ['AntiHookComponent', 'ScopedAntiHookComponent'];

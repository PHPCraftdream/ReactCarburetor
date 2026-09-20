/**
 * Optional bridge for embedding a carburetor into a hooks-based subtree — a router shell,
 * a third-party UI kit, an existing hooks codebase. The engine itself needs no hooks;
 * this entry point exists only for the boundary with code that does.
 */
export * from './Models';
export * from './useCarburetorValue';
export * from './useComputedValue';

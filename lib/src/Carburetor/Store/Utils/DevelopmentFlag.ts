// Declared locally instead of pulling in @types/node: the engine needs nothing from Node
// beyond this one value, and a module-scoped declaration cannot clash with a consumer's
// own global typings. Bundlers substitute the `process.env.NODE_ENV` member expression
// regardless of how it is typed.
declare const process: {env: {NODE_ENV?: string}};

/**
 * Whether development-only diagnostics are compiled in.
 *
 * Written as a module-level constant over the literal `process.env.NODE_ENV` comparison on
 * purpose: bundlers replace that expression at build time and fold this constant to `false`.
 */
export const IS_DEVELOPMENT: boolean = process.env.NODE_ENV !== 'production';

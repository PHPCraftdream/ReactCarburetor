/**
 * Whether development-only diagnostics are compiled in.
 *
 * Written as a module-level constant over a literal `process.env.NODE_ENV` comparison on
 * purpose: bundlers replace that expression at build time, fold this constant to `false`,
 * and then drop every `if (IS_DEVELOPMENT)` block together with its message strings. An
 * indirect lookup (`globalThis.process?.env`) would defeat that substitution and ship the
 * diagnostics to production. The `typeof` guard keeps it safe where `process` is absent.
 */
export declare const IS_DEVELOPMENT: boolean;

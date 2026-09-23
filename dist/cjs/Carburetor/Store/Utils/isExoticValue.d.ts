/**
 * Whether the value is an object the engine does not copy or track field by field — a Map, Set,
 * Date or class instance.
 *
 * Its reference can stay identical while its visible content mutates in place, so identity alone
 * proves nothing about its value: comparisons that meet one treat it as changed rather than
 * trusted by reference, the same conservative rule `sameSelection` applies to selection members.
 */
export declare const isExoticValue: (value: unknown) => boolean;

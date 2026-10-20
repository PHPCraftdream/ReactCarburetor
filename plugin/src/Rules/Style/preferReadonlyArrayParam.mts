import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Prefer readonly array parameters when a function does not mutate or retain the argument.
 *
 * The syntactic heuristic runs in the native binary; this opt-in rule fixes the array type.
 */
export const preferReadonlyArrayParam: IRule = nativeRule(
    'carburetor/prefer-readonly-array-param',
    'Prefer readonly array parameter types when the parameter is not mutated or retained.',
    {fixable: 'code'}
);

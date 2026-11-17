import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Markup carries exactly one Function class per element, written literally.
 *
 * Detection lives in the native crate: native/src/rules/classes/require_function_class/.
 * It reads the class index the binary builds from the project's `.carburetorrc.json`
 * `classes` section; without that section it reports nothing.
 */
export const requireFunctionClass: IRule = nativeRule(
    'carburetor/require-function-class',
    'Markup carries exactly one Function class per element, written literally.'
);

import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Ship at most one runtime-value export per file; type exports are unlimited.
 *
 * Every kind of value export counts — variables per binding, functions per name over overload
 * sets, classes, enums, namespaces with runtime content, default and `export =`. Type-only
 * exports, `declare` ambience, `.d.ts` files and re-export barrels are exempt. Detection lives
 * in the native crate now (native/src/rules/), which the JS plugin calls once per lint run and
 * reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why, and native/src/rules/
 * for the rule itself. See docs/hazards.md, H36.
 */
export const oneExportPerFile: IRule = nativeRule(
    'carburetor/one-export-per-file',
    'At most one runtime-value export per file; type exports are not limited.'
);

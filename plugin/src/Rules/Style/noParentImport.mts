import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/**
 * Import through the alias instead of reaching up out of the directory.
 *
 * Detection lives in the native crate (native/src/rules/style/no_parent_import/), which the
 * JS plugin calls once per lint run; its `roots` come from
 * `settings.carburetor.ruleOptions`.
 */
export const noParentImport: IRule = nativeRule(
    'carburetor/no-parent-import',
    'Import through the alias instead of reaching up out of the directory.'
);

import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/** What to tell a config that switched the rule on without naming a single root. */
const MISSING_ROOTS =
    'no-parent-import is on but names no roots, so it checks nothing. Give it the source roots it may ' +
    'alias: "carburetor/no-parent-import": ["error", {"roots": [{"path": "src", "prefix": "@/"}]}].';

/**
 * Import through the alias instead of reaching up out of the directory.
 *
 * Detection lives in the native crate (native/src/rules/style/no_parent_import/), which the JS
 * plugin calls once per lint run. Its `roots` come from the rule's own options
 * (`["error", {"roots": [...]}]`) or from `settings.carburetor.ruleOptions`; with neither, the
 * rule says once that it checks nothing. The rule autofixes through the native bridge.
 */
export const noParentImport: IRule = nativeRule(
    'carburetor/no-parent-import',
    'Import through the alias instead of reaching up out of the directory.',
    {
        schema: [{type: 'object'}],
        forwardOptions: true,
        missingOptions: (options) => {
            const roots = options?.roots;

            return Array.isArray(roots) && roots.length > 0 ? undefined : MISSING_ROOTS;
        },
        fixable: 'code',
    }
);

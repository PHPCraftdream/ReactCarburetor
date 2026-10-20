import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {INativeDiagnostic} from "#src/Utils/Native/INativeDiagnostic.mts";
import type {IRule} from "#src/Models.mts";

/** The rule's option, exactly as its native config spells it: `all` is the default. */
type TScope = 'all' | 'classes';

/** The scope a host config asked for: ESLint style, the first element of `context.options`. */
const scopeOption = (options: readonly unknown[]): TScope => {
    const option = options[0] as {scope?: TScope} | undefined;

    return option?.scope === 'classes' ? 'classes' : 'all';
};

/**
 * Declare code that uses nothing from the class at module level, so it is built once.
 *
 * With the default `scope: "all"` the rule also covers nested functions outside classes; with
 * `{"scope": "classes"}` only the class members and member closures are reported, the behavior
 * the rule had before the option existed. The option is applied here, not by the binary: the
 * bridge runs it once with every rule forced on, so the option can only narrow this rule's own
 * slice of the one shared result. A diagnostic without a `scope` field comes from an older
 * binary and predates the option, so it is kept whatever the option says.
 *
 * Detection lives in the native crate now (native/src/rules/), which the JS plugin calls once
 * per lint run and reports through -- see plugin/src/Utils/Native/nativeBridge.mts for why,
 * and native/src/rules/ for the rule itself. See docs/hazards.md, H30. The rule autofixes
 * through the native bridge.
 */
export const requireModuleFunction: IRule = nativeRule(
    'carburetor/require-module-function',
    'Declare code that uses nothing from the class at module level, so it is built once.',
    {
        schema: [{
            type: 'object',
            properties: {scope: {type: 'string', enum: ['all', 'classes']}},
            additionalProperties: false,
        }],
        filter: (diagnostic: INativeDiagnostic, options: readonly unknown[]): boolean =>
            scopeOption(options) !== 'classes' || diagnostic.scope !== 'module',
        fixable: 'code',
    }
);

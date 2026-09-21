/** A fixture for the internal style rules, run through the real binary rather than RuleTester. */

/** Documented and exported directly: the doc sits above `export`, not above `function`. */
export function documentedExport(): void {}

/** Documented, no export wrapper in the way. */
export const documentedConst = (): void => {};

/** Documented, but split off from its declaration by a blank line. */

export function gapExport(): void {}

export function undocumentedExport(): void {}

declare const bind: (value: unknown, context: unknown) => void;

/** Over the limit because of code, not a literal: the rule reports this one. */
export const overLimitByCode = (first: number, second: number, third: number, fourth: number): number => first + second + third + fourth;

/** Over the limit because of one long string, which `ignoreStrings` excuses by default. */
export const overLimitByString = 'flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700';

/** Documented, and exported with the doc above `export`. */
export class Widget {
    /** Documented, with a decorator standing between the doc and the method. */
    @bind
    handleClick(): void {}

    undocumentedMethod(): void {}
}

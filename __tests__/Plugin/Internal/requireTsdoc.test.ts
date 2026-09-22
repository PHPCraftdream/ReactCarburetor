import {RuleTester} from "oxlint/plugins-dev";
import {requireTsdoc} from "@plugin-internal/Rules/requireTsdoc.mts";

const rule = requireTsdoc as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'ts'}}});

tester.run('require-tsdoc', rule, {
    valid: [
        {
            name: 'a documented method',
            code: [
                'class Counter {',
                '    /** Adds one to the count. */',
                '    increment(): void {}',
                '}',
            ].join('\n'),
        },
        {
            name: 'a documented arrow-function class property',
            code: [
                'class Counter {',
                '    /** Rebuilds the tally. */',
                '    tally = (): number => 1;',
                '}',
            ].join('\n'),
        },
        {
            name: 'a documented exported const arrow function',
            code: [
                '/** Builds a counter. */',
                'export const build = (): void => {};',
            ].join('\n'),
        },
        {
            // Regression: the doc sits above `export`, so reading the comments before the
            // `FunctionDeclaration` found none and every documented export was reported.
            name: 'a documented exported function declaration',
            code: [
                '/** Builds a counter. */',
                'export function build(): void {}',
            ].join('\n'),
        },
        {
            name: 'a documented default-exported function',
            code: [
                '/** Builds a counter. */',
                'export default function build(): void {}',
            ].join('\n'),
        },
        {
            name: 'a documented method behind a decorator',
            code: [
                'class Counter {',
                '    /** Adds one to the count. */',
                '    @bind',
                '    increment(): void {}',
                '}',
            ].join('\n'),
        },
        {
            // Only the summary is measured: this repository documents *why*, which takes
            // paragraphs, and a limit on the whole comment would be a limit on explaining.
            name: 'a short summary followed by a long rationale under maxLines 3',
            code: [
                'class Counter {',
                '    /**',
                '     * Adds one to the count.',
                '     *',
                '     * The carry wraps at midnight the way a clock does, which is the whole reason',
                '     * this is not a plain increment: the display reads the wrapped value, and a',
                '     * reader who sees 0 after 23 needs the sentence above to know it was not a bug.',
                '     * A fourth line of rationale, to be sure the limit is not counting these.',
                '     */',
                '    increment(): void {}',
                '}',
            ].join('\n'),
            options: [{maxLines: 3}],
        },
        {
            name: 'an overload signature without a doc, exempt by default',
            code: [
                'function pick(first: string): string;',
                'function pick(first: string, second: number): string;',
                '/** Picks the first value. */',
                'function pick(first: string, second?: number): string {',
                '    return first;',
                '}',
            ].join('\n'),
        },
        {
            name: 'a pure @inheritdoc doc on a method, exempt by default',
            code: [
                'class Counter {',
                '    /** @inheritdoc */',
                '    render(): void {}',
                '}',
            ].join('\n'),
        },
        {
            name: 'a getter and setter without docs under allowTrivialAccessors',
            code: [
                'class Amount {',
                '    get value(): number { return 1; }',
                '    set value(next: number) {}',
                '}',
            ].join('\n'),
            options: [{allowTrivialAccessors: true}],
        },
        {
            name: 'a private method without a doc under access public',
            code: [
                'class Amount {',
                '    private log(): void {}',
                '}',
            ].join('\n'),
            options: [{access: 'public'}],
        },
        {
            name: 'a function with every parameter tagged under requireParamDocs',
            code: [
                '/**',
                ' * Picks a value.',
                ' *',
                ' * @param first - the first choice.',
                ' * @param second - the fallback when the first is missing.',
                ' */',
                'function pick(first: string, second: number): string {',
                '    return first;',
                '}',
            ].join('\n'),
            options: [{requireParamDocs: true}],
        },
        {
            name: 'a single-parameter function without a @param tag, exempt',
            code: [
                '/** Wraps a value. */',
                'function wrap(value: string): string {',
                '    return value;',
                '}',
            ].join('\n'),
            options: [{requireParamDocs: true}],
        },
        {
            name: 'a constructor parameter property documented by its own @param tag',
            code: [
                'class Box {',
                '    /**',
                '     * Builds a box.',
                '     *',
                '     * @param data - the initial contents.',
                '     * @param scale - the drawing scale.',
                '     */',
                '    constructor(protected data: T, scale: number) {}',
                '}',
            ].join('\n'),
            options: [{requireParamDocs: true, requireFieldDocs: true}],
        },
        {
            name: 'a defaulted constructor parameter property tagged by its own name',
            code: [
                'class Box {',
                '    /**',
                '     * Builds a box.',
                '     *',
                '     * @param data - the initial contents.',
                '     * @param scale - the drawing scale.',
                '     */',
                '    constructor(protected data: T, protected scale: number = 1) {}',
                '}',
            ].join('\n'),
            options: [{requireParamDocs: true, requireFieldDocs: true}],
        },
        {
            name: 'a plain documented field under requireFieldDocs',
            code: [
                'class Counter {',
                '    /** The current count. */',
                '    count: number = 0;',
                '}',
            ].join('\n'),
            options: [{requireFieldDocs: true}],
        },
        {
            name: 'an undocumented plain field with the new options off',
            code: [
                'class Counter {',
                '    count: number = 0;',
                '}',
            ].join('\n'),
        },
        {
            name: 'an overload signature with the new checks on',
            code: [
                'function pick(first: string): string;',
                'function pick(first: string, second: number): string;',
                '/**',
                ' * Picks the first value.',
                ' *',
                ' * @param first - the first choice.',
                ' * @param second - the fallback when the first is missing.',
                ' */',
                'function pick(first: string, second?: number): string {',
                '    return first;',
                '}',
            ].join('\n'),
            options: [{requireParamDocs: true, requireFieldDocs: true}],
        },
        {
            name: 'a pure @inheritdoc method with untagged parameters',
            code: [
                'class Counter {',
                '    /** @inheritdoc */',
                '    render(value: number): void {}',
                '}',
            ].join('\n'),
            options: [{requireParamDocs: true, requireFieldDocs: true}],
        },
        {
            name: 'a private method with untagged parameters under access public',
            code: [
                'class Amount {',
                '    private log(message: string): void {}',
                '}',
            ].join('\n'),
            options: [{access: 'public', requireParamDocs: true, requireFieldDocs: true}],
        },
        {
            name: 'a getter and setter with the new checks on',
            code: [
                'class Amount {',
                '    get value(): number { return 1; }',
                '    set value(next: number) {}',
                '}',
            ].join('\n'),
            options: [{allowTrivialAccessors: true, requireParamDocs: true, requireFieldDocs: true}],
        },
        {
            name: 'a private plain field under access public and requireFieldDocs',
            code: [
                'class Amount {',
                '    private secret: string = \'\';',
                '}',
            ].join('\n'),
            options: [{access: 'public', requireFieldDocs: true}],
        },
    ],
    invalid: [
        {
            name: 'an undocumented method',
            code: [
                'class Counter {',
                '    increment(): void {}',
                '}',
            ].join('\n'),
            errors: [{message: /Method 'increment' is missing its TSDoc comment\./}],
        },
        {
            name: 'an undocumented arrow-function class property',
            code: [
                'class Counter {',
                '    tally = (): number => 1;',
                '}',
            ].join('\n'),
            errors: [{message: /Class property 'tally' is missing its TSDoc comment\./}],
        },
        {
            name: 'an undocumented exported const function',
            code: 'export const build = (): void => {};',
            errors: [{message: /Exported function 'build' is missing its TSDoc comment\./}],
        },
        {
            name: 'an undocumented function declaration',
            code: 'function pick(first: string): string { return first; }',
            errors: [{message: /Function 'pick' is missing its TSDoc comment\./}],
        },
        {
            name: 'a // comment where a block is required',
            code: [
                'class Counter {',
                '    // Adds one to the count.',
                '    increment(): void {}',
                '}',
            ].join('\n'),
            errors: [{message: /Method 'increment' has a \/\/ comment where a \/\*\* \*\/ TSDoc block is required\./}],
        },
        {
            name: 'a plain block where TSDoc is required',
            code: [
                'class Counter {',
                '    /* Adds one to the count. */',
                '    increment(): void {}',
                '}',
            ].join('\n'),
            errors: [{
                message: /Method 'increment' is documented with a plain \/\* \*\/ block; TSDoc requires \/\*\* \*\//,
            }],
        },
        {
            name: 'a pure @inheritdoc doc when allowInheritdoc is false',
            code: [
                'class Counter {',
                '    /** @inheritdoc */',
                '    render(): void {}',
                '}',
            ].join('\n'),
            options: [{allowInheritdoc: false}],
            errors: [{message: /The TSDoc on 'render' has no description\./}],
        },
        {
            name: 'an overload signature when allowOverloads is false',
            code: 'function pick(first: string): string;',
            options: [{allowOverloads: false}],
            errors: [{message: /Function 'pick' is missing its TSDoc comment\./}],
        },
        {
            name: 'a doc with an empty description',
            code: [
                'class Counter {',
                '    /** */',
                '    increment(): void {}',
                '}',
            ].join('\n'),
            errors: [{message: /The TSDoc on 'increment' has no description\./}],
        },
        {
            name: 'a five-line summary under maxLines 3',
            code: [
                'class Counter {',
                '    /**',
                '     * Adds one to the count and,',
                '     * when the carry overflows,',
                '     * wraps the counter around,',
                '     * resetting it to zero,',
                '     * as clocks do at midnight.',
                '     */',
                '    increment(): void {}',
                '}',
            ].join('\n'),
            options: [{maxLines: 3}],
            errors: [{message: /The TSDoc summary on 'increment' is 5 lines; the maximum is 3\./}],
        },
        {
            name: 'a function missing a @param tag for one parameter',
            code: [
                '/**',
                ' * Picks a value.',
                ' *',
                ' * @param first - the first choice.',
                ' */',
                'function pick(first: string, second: number): string {',
                '    return first;',
                '}',
            ].join('\n'),
            options: [{requireParamDocs: true}],
            errors: [{message: /The TSDoc on 'pick' is missing a @param tag for 'second'\./}],
        },
        {
            name: 'a @param tag with an empty description',
            code: [
                '/**',
                ' * Picks a value.',
                ' *',
                ' * @param first -',
                ' * @param second',
                ' */',
                'function pick(first: string, second: number): string {',
                '    return first;',
                '}',
            ].join('\n'),
            options: [{requireParamDocs: true}],
            errors: [
                {message: /The @param tag for 'first' on 'pick' has no description\./},
                {message: /The @param tag for 'second' on 'pick' has no description\./},
            ],
        },
        {
            name: 'a method missing a @param tag for one parameter',
            code: [
                'class Counter {',
                '    /**',
                '     * Adds an amount to the count.',
                '     *',
                '     * @param amount - the amount to add.',
                '     */',
                '    add(amount: number, times: number): void {}',
                '}',
            ].join('\n'),
            options: [{requireParamDocs: true}],
            errors: [{message: /The TSDoc on 'add' is missing a @param tag for 'times'\./}],
        },
        {
            name: 'a constructor parameter property among untagged parameters',
            code: [
                'class Box {',
                '    /**',
                '     * Builds a box.',
                '     *',
                '     * @param data - the initial contents.',
                '     */',
                '    constructor(protected data: T, scale: number) {}',
                '}',
            ].join('\n'),
            options: [{requireParamDocs: true}],
            errors: [{message: /The TSDoc on 'constructor' is missing a @param tag for 'scale'\./}],
        },
        {
            name: 'a defaulted constructor parameter property is still matched to its @param tag',
            code: [
                'class Box {',
                '    /**',
                '     * Builds a box.',
                '     *',
                '     * @param data - the initial contents.',
                '     */',
                '    constructor(protected data: T, protected scale: number = 1) {}',
                '}',
            ].join('\n'),
            options: [{requireParamDocs: true}],
            errors: [{message: /The TSDoc on 'constructor' is missing a @param tag for 'scale'\./}],
        },
        {
            name: 'a single-parameter function whose only tag has no description',
            code: [
                '/**',
                ' * Wraps a value.',
                ' *',
                ' * @param value -',
                ' */',
                'function wrap(value: string): string {',
                '    return value;',
                '}',
            ].join('\n'),
            options: [{requireParamDocs: true}],
            errors: [{message: /The @param tag for 'value' on 'wrap' has no description\./}],
        },
        {
            name: 'an undocumented plain field under requireFieldDocs',
            code: [
                'class Counter {',
                '    count: number = 0;',
                '}',
            ].join('\n'),
            options: [{requireFieldDocs: true}],
            errors: [{message: /Class property 'count' is missing its TSDoc comment\./}],
        },
        {
            name: 'a plain field with an empty doc under requireFieldDocs',
            code: [
                'class Counter {',
                '    /** */',
                '    count: number = 0;',
                '}',
            ].join('\n'),
            options: [{requireFieldDocs: true}],
            errors: [{message: /The TSDoc on 'count' has no description\./}],
        },
        {
            name: 'an exported const function missing a @param tag',
            code: [
                '/**',
                ' * Builds a tally.',
                ' *',
                ' * @param start - the starting count.',
                ' */',
                'export const build = (start: number, step: number): number => start;',
            ].join('\n'),
            options: [{requireParamDocs: true}],
            errors: [{message: /The TSDoc on 'build' is missing a @param tag for 'step'\./}],
        },
    ],
});

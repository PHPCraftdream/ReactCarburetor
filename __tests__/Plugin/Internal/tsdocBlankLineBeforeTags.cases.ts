import {RuleTester} from "oxlint/plugins-dev";
import {tsdocBlankLineBeforeTags} from "@plugin-internal/Rules/tsdocBlankLineBeforeTags.mts";

/**
 * Every invalid case asserts the rewritten comment: whatever the blank-line count was, the fix
 * leaves exactly one, in the tag line's own `*` column.
 */
const rule = tsdocBlankLineBeforeTags as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'ts'}}});

const MISSING = /Add one blank line between the TSDoc description and its first tag\./;
const TOO_MANY = /Keep exactly one blank line between the TSDoc description and its first tag, not 2\./;

/** Registers this rule's suite; called from internalRules.test.ts. */
export const registerTsdocBlankLineBeforeTagsCases = (): void => {
    tester.run('tsdoc-blank-line-before-tags', rule, {
        valid: [
            {
                name: 'one blank line between the description and the params',
                code: [
                    '/**',
                    ' * Adds two amounts.',
                    ' *',
                    ' * @param a - the first amount',
                    ' * @param b - the second amount',
                    ' */',
                    'function add(a: number, b: number): number {',
                    '    return a + b;',
                    '}',
                ].join('\n'),
            },
            {
                name: 'a single-line doc',
                code: '/** Adds two amounts. */\nfunction add(a: number, b: number): number {\n    return a + b;\n}',
            },
            {
                name: 'tags only, no description',
                code: '/**\n * @param a - the amount\n */\nfunction twice(a: number): number {\n    return a * 2;\n}',
            },
            {
                name: 'a description without tags',
                code: '/**\n * Adds one.\n *\n * Nothing else to say.\n */\nfunction inc(a: number): number {\n    return a + 1;\n}',
            },
            {
                name: 'a line starting with @ inside a code fence is code, not a tag',
                code: [
                    '/**',
                    ' * Binds once:',
                    ' * ```ts',
                    ' * @bind',
                    ' * handle() {}',
                    ' * ```',
                    ' */',
                    'function example(): void {}',
                ].join('\n'),
            },
            {
                name: 'a plain block comment is not TSDoc',
                code: '/*\n * Not a doc.\n * @param nothing\n */\nfunction plain(): void {}',
            },
        ],
        invalid: [
            {
                name: 'no blank line before the params',
                code: [
                    '/**',
                    ' * Adds two amounts.',
                    ' * @param a - the first amount',
                    ' */',
                    'function add(a: number): number {',
                    '    return a;',
                    '}',
                ].join('\n'),
                output: [
                    '/**',
                    ' * Adds two amounts.',
                    ' *',
                    ' * @param a - the first amount',
                    ' */',
                    'function add(a: number): number {',
                    '    return a;',
                    '}',
                ].join('\n'),
                errors: [{message: MISSING}],
            },
            {
                name: 'two blank lines collapse to one',
                code: [
                    '/**',
                    ' * Adds two amounts.',
                    ' *',
                    ' *',
                    ' * @param a - the first amount',
                    ' */',
                    'function add(a: number): number {',
                    '    return a;',
                    '}',
                ].join('\n'),
                output: [
                    '/**',
                    ' * Adds two amounts.',
                    ' *',
                    ' * @param a - the first amount',
                    ' */',
                    'function add(a: number): number {',
                    '    return a;',
                    '}',
                ].join('\n'),
                errors: [{message: TOO_MANY}],
            },
            {
                name: 'a description on the opening line, indented in a class',
                code: [
                    'class Counter {',
                    '    /** Adds to the count.',
                    '     * @param by - how much',
                    '     */',
                    '    add(by: number): void {}',
                    '}',
                ].join('\n'),
                output: [
                    'class Counter {',
                    '    /** Adds to the count.',
                    '     *',
                    '     * @param by - how much',
                    '     */',
                    '    add(by: number): void {}',
                    '}',
                ].join('\n'),
                errors: [{message: MISSING}],
            },
            {
                name: 'the first tag decides, whatever it is',
                code: '/**\n * Reads it.\n * @returns the value\n */\nfunction read(): number {\n    return 1;\n}',
                output: '/**\n * Reads it.\n *\n * @returns the value\n */\n'
                    + 'function read(): number {\n    return 1;\n}',
                errors: [{message: MISSING}],
            },
        ],
    });
};

import {RuleTester} from "oxlint/plugins-dev";
import {maxLineLength} from "@plugin-internal/Rules/maxLineLength.mts";

/**
 * Line content is built so each case's intent stays visible: a comment padded with `x`s is the
 * plainest possible over-limit line, and the padded string/template cases put the over-limit
 * character inside the literal, which is what the ignore flags decide on.
 */
const rule = maxLineLength as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'ts'}}});

tester.run('max-line-length', rule, {
    valid: [
        {
            name: 'a line exactly at the default limit of 120',
            code: `// ${'x'.repeat(117)}`,
        },
        {
            name: 'a long URL in a comment under ignoreUrls',
            code: `// documented at https://example.com/${'a'.repeat(120)}`,
            options: [{ignoreUrls: true}],
        },
        {
            name: 'a long string literal, skipped because ignoreStrings defaults to true',
            code: `const label = "${'a'.repeat(130)}";`,
        },
        {
            name: 'a long template literal under ignoreTemplateLiterals',
            code: `const text = \`${'t'.repeat(130)}\`;`,
            options: [{ignoreTemplateLiterals: true}],
        },
        {
            name: 'tab indentation counts as one column under tabWidth 1 (120 columns exactly)',
            code: `\t// ${'x'.repeat(116)}`,
            options: [{tabWidth: 1}],
        },
        {
            name: 'a line matching ignorePattern',
            code: `// padding ${'x'.repeat(128)}`,
            options: [{ignorePattern: '^// padding'}],
        },
    ],
    invalid: [
        {
            name: 'one character past the default limit',
            code: `// ${'x'.repeat(118)}`,
            errors: [{message: /Line 1 is 121 characters long; the maximum is 120\./}],
        },
        {
            name: 'a long string literal reports when ignoreStrings is false',
            code: `const label = "${'a'.repeat(130)}";`,
            options: [{ignoreStrings: false}],
            errors: [{message: /Line 1 is 147 characters long/}],
        },
        {
            name: 'a long template literal reports by default',
            code: `const text = \`${'t'.repeat(130)}\`;`,
            errors: [{message: /Line 1 is 146 characters long/}],
        },
        {
            name: 'tab indentation counts per tabWidth 4 by default',
            code: `\t// ${'x'.repeat(116)}`,
            errors: [{message: /Line 1 is 123 characters long/}],
        },
        {
            name: 'a line only ignorePattern would excuse',
            code: `// padding ${'x'.repeat(128)}`,
            errors: [{message: /Line 1 is 139 characters long/}],
        },
    ],
});

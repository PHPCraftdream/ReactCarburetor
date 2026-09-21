import {RuleTester} from "oxlint/plugins-dev";
import {noBlankLineAfterTsdoc} from "@plugin-internal/Rules/noBlankLineAfterTsdoc.mts";

/**
 * The fix is the point of this rule, so every invalid case asserts the rewritten source: the blank
 * line must go while the declaration keeps its exact indentation.
 */
const rule = noBlankLineAfterTsdoc as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'ts'}}});

tester.run('no-blank-line-after-tsdoc', rule, {
    valid: [
        {
            name: 'a doc directly above a function',
            code: [
                '/** Adds two amounts. */',
                'function add(a: number, b: number): number {',
                '    return a + b;',
                '}',
            ].join('\n'),
        },
        {
            name: 'a doc directly above an indented class method',
            code: [
                'class Counter {',
                '    /** Adds one to the count. */',
                '    increment(): void {}',
                '}',
            ].join('\n'),
        },
    ],
    invalid: [
        {
            name: 'one blank line between a doc and a function',
            code: [
                '/** Adds two amounts. */',
                '',
                'function add(a: number, b: number): number {',
                '    return a + b;',
                '}',
            ].join('\n'),
            output: [
                '/** Adds two amounts. */',
                'function add(a: number, b: number): number {',
                '    return a + b;',
                '}',
            ].join('\n'),
            errors: [{message: /A blank line separates the TSDoc comment from 'add'\./}],
        },
        {
            name: 'a blank line before an indented method, whose indent the fix keeps',
            code: [
                'class Counter {',
                '    /** Adds one to the count. */',
                '',
                '    increment(): void {}',
                '}',
            ].join('\n'),
            output: [
                'class Counter {',
                '    /** Adds one to the count. */',
                '    increment(): void {}',
                '}',
            ].join('\n'),
            errors: [{message: /A blank line separates the TSDoc comment from 'increment'\./}],
        },
        {
            // Regression: the doc of an exported declaration sits above `export`, so reading the
            // comments before the declaration itself found none and the gap went unreported.
            name: 'a blank line before an exported function declaration',
            code: [
                '/** Adds two amounts. */',
                '',
                'export function add(a: number, b: number): number {',
                '    return a + b;',
                '}',
            ].join('\n'),
            output: [
                '/** Adds two amounts. */',
                'export function add(a: number, b: number): number {',
                '    return a + b;',
                '}',
            ].join('\n'),
            errors: [{message: /A blank line separates the TSDoc comment from 'add'\./}],
        },
        {
            name: 'a blank line before an exported class',
            code: [
                '/** Counts things. */',
                '',
                'export class Counter {}',
            ].join('\n'),
            output: [
                '/** Counts things. */',
                'export class Counter {}',
            ].join('\n'),
            errors: [{message: /A blank line separates the TSDoc comment from 'Counter'\./}],
        },
        {
            name: 'two blank lines collapse into none',
            code: [
                '/** Adds two amounts. */',
                '',
                '',
                'function add(a: number, b: number): number {',
                '    return a + b;',
                '}',
            ].join('\n'),
            output: [
                '/** Adds two amounts. */',
                'function add(a: number, b: number): number {',
                '    return a + b;',
                '}',
            ].join('\n'),
            errors: [{message: /A blank line separates the TSDoc comment from 'add'\./}],
        },
    ],
});

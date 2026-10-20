import * as path from "node:path";
import {describe, expect, rstest, test} from "@rstest/core";

/** The stubbed `runNative`: its return value is what the bridge would hand the rule. */
const runNativeMock = rstest.hoisted(() => rstest.fn());

rstest.mock('@plugin/Utils/Native/nativeBridge.mts', () => ({runNative: runNativeMock}));

import {utf16FromByte} from "@plugin/Utils/utf16FromByte.mts";
import {nativeRule} from "@plugin/Utils/Native/nativeRule.mts";

/** A minimal host surface: the source text in, every report captured. */
const runRule = (id: string, text: string, filename: string): Array<{
    node: unknown;
    message: string;
    fix?: (fixer: {replaceText(node: {range: [number, number]}, text: string): unknown}) => unknown;
}> => {
    const reports: Array<Record<string, unknown>> = [];
    const rule = nativeRule(id, 'test');

    rule.create({
        id,
        filename,
        options: [],
        sourceCode: {
            getText: () => text,
            getCommentsBefore: () => [],
            getAllComments: () => [],
        },
        report: (diagnostic) => reports.push(diagnostic as Record<string, unknown>),
    } as never)['Program:exit']();

    return reports as never;
};

describe('utf16FromByte', () => {
    test('ASCII bytes and UTF-16 units agree one to one', () => {
        expect(utf16FromByte('abc', 0)).toBe(0);
        expect(utf16FromByte('abc', 2)).toBe(2);
        expect(utf16FromByte('abc', 3)).toBe(3);
        expect(utf16FromByte('abc', 999)).toBe(3);
    });

    test('a mixed string maps byte offsets onto the right UTF-16 indices', () => {
        // Bytes: a=0; 😀=1..5 (4 bytes, 2 units); б=5..7 (2 bytes, 1 unit); b=7; c=8.
        const text = 'a😀бbc';

        expect(utf16FromByte(text, 0)).toBe(0);
        expect(utf16FromByte(text, 1)).toBe(1); // start of 😀
        expect(utf16FromByte(text, 5)).toBe(3); // start of б, after 😀
        expect(utf16FromByte(text, 7)).toBe(4); // start of b, after б
        expect(utf16FromByte(text, 8)).toBe(5);
        expect(utf16FromByte(text, 999)).toBe(text.length);
    });

    test('an offset inside a multi-byte character stops at its start', () => {
        const text = 'a😀б';

        expect(utf16FromByte(text, 2)).toBe(1);
        expect(utf16FromByte(text, 4)).toBe(1);
    });
});

describe('nativeRule fix bridge', () => {
    test('meta carries fixable only when the rule asks for it', () => {
        expect(nativeRule('x/rule', 'test', {fixable: 'code'}).meta?.fixable).toBe('code');
        expect(nativeRule('x/rule', 'test').meta?.fixable).toBeUndefined();
    });

    test('a diagnostic with a fix reports a host fix over the converted UTF-16 range', () => {
        // Line 1 `// 😀\n` is 8 bytes but 6 UTF-16 units; the literal starts at byte 23,
        // unit 21.
        const text = "// 😀\nimport x from '../y';";
        const filename = path.resolve('fixture.ts');

        runNativeMock.mockReturnValue([{
            file: './fixture.ts',
            line: 2,
            column: 16,
            rule: 'x/rule',
            message: 'msg',
            severity: 'error',
            fix: {start: 23, end: 28, text: "'@/y'"},
        }]);

        const [report] = runRule('x/rule', text, filename);

        expect(report.fix).toBeDefined();

        let applied: {range: [number, number]; text: string} | undefined;
        report.fix!({replaceText: (node, replacement) => {
            applied = {range: node.range, text: replacement};
        }});

        expect(applied).toEqual({range: [21, 26], text: "'@/y'"});
    });

    test('a diagnostic without a fix reports as before, with no fix callback', () => {
        const filename = path.resolve('plain.ts');

        runNativeMock.mockReturnValue([{
            file: './plain.ts',
            line: 1,
            column: 1,
            rule: 'x/rule',
            message: 'msg',
            severity: 'error',
        }]);

        const [report] = runRule('x/rule', 'const a = 1;', filename);

        expect(report.message).toBe('msg');
        expect(report.fix).toBeUndefined();
    });
});

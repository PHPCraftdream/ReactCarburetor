import {execFileSync} from "node:child_process";
import {existsSync} from "node:fs";
import * as path from "node:path";
import {describe, expect, test} from "@rstest/core";

/**
 * Runs both implementations of the 22 carburetor rules over the same fixture corpus and asserts
 * they find the same problems in the same places.
 *
 * The corpus is `plugin/__fixtures__/{reads,writes,lifecycle,effects,boundaries,
 * lifecycleClassProperty}`, already written so every rule fires exactly once — the same files the
 * JS plugin's own host tests exercise. Comparison is on `(file, line, column, rule)`: that is the
 * behavioural contract a consumer depends on. Message text is compared too, because both
 * implementations deliberately share the same wording word for word; a mismatch there means one
 * side drifted from the other, not that phrasing is free to differ.
 */
const ROOT: string = process.cwd();
const NATIVE_BINARY: string = path.join(
    ROOT,
    'native',
    'target',
    'release',
    process.platform === 'win32' ? 'carburetor-lint.exe' : 'carburetor-lint',
);
const NATIVE_CONFIG: string = path.join('native', 'tests', 'fixtures', 'conformance.carburetorrc.json');
const JS_CONFIG: string = path.join('plugin', '__fixtures__', 'oxlintrc.json');
const CORPUS: readonly string[] = [
    'reads.tsx',
    'writes.tsx',
    'lifecycle.tsx',
    'effects.tsx',
    'boundaries.ts',
    'lifecycleClassProperty.tsx',
].map((name) => path.join('plugin', '__fixtures__', name));

interface IDiagnostic {
    file: string;
    line: number;
    column: number;
    rule: string;
    message: string;
}

/** One diagnostic, normalised to what both sides agree on: not severity, which is presentation. */
const key = (diagnostic: IDiagnostic): string =>
    `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}:${diagnostic.rule}:${diagnostic.message}`;

/** Exit code 1 means "problems found", not "the command failed" — both outcomes carry stdout. */
const runCapturingStdout = (binary: string, args: string[]): string => {
    try {
        return execFileSync(binary, args, {encoding: 'utf8', cwd: ROOT});
    } catch (error) {
        return (error as {stdout?: string}).stdout || '';
    }
};

const nativeDiagnostics = (): IDiagnostic[] => {
    const output = runCapturingStdout(NATIVE_BINARY, ['--config', NATIVE_CONFIG, '--format=json', ...CORPUS]);

    return (JSON.parse(output) as IDiagnostic[]).map((diagnostic) => ({
        ...diagnostic,
        file: diagnostic.file.replace(/\\/g, '/'),
    }));
};

interface IOxlintSpan {
    labels: {span: {line: number; column: number}}[];
    filename: string;
    code: string;
    message: string;
}

const jsDiagnostics = (): IDiagnostic[] => {
    const output = runCapturingStdout(process.execPath, [
        path.join('node_modules', 'oxlint', 'bin', 'oxlint'),
        '-c',
        JS_CONFIG,
        '--format=json',
        ...CORPUS,
    ]);
    const parsed = JSON.parse(output) as {diagnostics: IOxlintSpan[]};

    return parsed.diagnostics.map((diagnostic) => {
        // `carburetor(rule-name)` -> `carburetor/rule-name`, the native side's own spelling.
        const rule = diagnostic.code.replace('carburetor(', 'carburetor/').replace(')', '');
        const span = diagnostic.labels[0].span;

        return {
            file: diagnostic.filename.replace(/\\/g, '/'),
            line: span.line,
            column: span.column,
            rule,
            message: diagnostic.message,
        };
    });
};

describe('conformance: native binary vs the JavaScript plugin', () => {
    test('the native binary is built', () => {
        expect(
            existsSync(NATIVE_BINARY),
            `${NATIVE_BINARY} is missing. Run "cargo build --release" in native/ before this test.`,
        ).toBe(true);
    });

    test('both implementations report the same diagnostics over the shared corpus', () => {
        const native = nativeDiagnostics();
        const js = jsDiagnostics();

        expect(native.length).toBeGreaterThan(0);
        expect(js.length).toBeGreaterThan(0);

        const nativeKeys = native.map(key).sort();
        const jsKeys = js.map(key).sort();

        expect(nativeKeys).toEqual(jsKeys);
    });

    test('every one of the 22 rules is represented in the corpus', () => {
        const seen = new Set(nativeDiagnostics().map((diagnostic) => diagnostic.rule));

        // no-module-level-store is off by default in both implementations but is force-enabled by
        // both configs above specifically so this corpus can prove it fires identically too.
        expect(seen.size).toBe(22);
    });
});

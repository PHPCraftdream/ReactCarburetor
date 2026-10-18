import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {describe, expect, test} from "@rstest/core";

/**
 * Every JS rule is a `nativeRule` bridge (see plugin/src/Utils/Native/nativeRule.mts) that
 * delegates to the same native binary, so this suite is a bridge round-trip, not a comparison of
 * two independent implementations: it pins the bridge's file/line/column mapping and keeps the
 * corpus covering every catalogue rule. It cannot catch a rule-logic regression, because both
 * sides are one binary.
 *
 * The corpus is grouped by topic under `plugin/__fixtures__`, written so every rule fires exactly
 * once — the same files the JS plugin's host tests exercise. Comparison is on
 * `(file, line, column, rule)`: the behavioural contract a consumer depends on.
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
    path.join('plugin', '__fixtures__', 'data', 'allocations.tsx'),
    path.join('plugin', '__fixtures__', 'data', 'reads.tsx'),
    path.join('plugin', '__fixtures__', 'data', 'writes.tsx'),
    path.join('plugin', '__fixtures__', 'lifecycle', 'lifecycle.tsx'),
    path.join('plugin', '__fixtures__', 'operations', 'effects.tsx'),
    path.join('plugin', '__fixtures__', 'operations', 'boundaries.ts'),
    path.join('plugin', '__fixtures__', 'lifecycle', 'lifecycleClassProperty.tsx'),
    path.join('plugin', '__fixtures__', 'function-components.tsx'),
    path.join('plugin', '__fixtures__', 'consumer', 'noHooks.jsx'),
];

interface IDiagnostic {
    file: string;
    line: number;
    column: number;
    rule: string;
    message: string;
}

/** One diagnostic, normalised to what both sides agree on: not severity, which is presentation. */
const key = (diagnostic: IDiagnostic): string =>
    `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}:${diagnostic.rule}`;

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

/** The rule catalogue, as bare names, straight out of the Rust source's `DEFAULT_SEVERITIES`. */
const nativeRegistryRules = (): string[] => {
    const source = readFileSync(path.join(ROOT, 'native', 'src', 'config.rs'), 'utf8');
    const table = /DEFAULT_SEVERITIES[^=]*=\s*&\[(.*?)\];/s.exec(source);

    expect(table, 'DEFAULT_SEVERITIES is still a slice literal in native/src/config.rs').not.toBeNull();

    return [...(table as RegExpExecArray)[1].matchAll(/\("([^"]+)",\s*Severity::(\w+)\)/g)].map(([, name]) => name);
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

describe('bridge round-trip: native binary vs the JavaScript plugin bridge', () => {
    test('both implementations report the same diagnostics over the shared corpus', () => {
        const native = nativeDiagnostics();
        const js = jsDiagnostics();

        expect(native.length).toBeGreaterThan(0);
        expect(js.length).toBeGreaterThan(0);

        const nativeKeys = native.map(key).sort();
        const jsKeys = js.map(key).sort();

        expect(nativeKeys).toEqual(jsKeys);
    });

    test('every catalogue rule is represented in the corpus', () => {
        const seen = new Set(nativeDiagnostics().map((diagnostic) => diagnostic.rule));

        // no-module-level-store is off by default in both implementations but is force-enabled by
        // both configs above specifically so this corpus can prove it fires identically too.
        expect([...seen].sort()).toEqual(nativeRegistryRules().map((name) => 'carburetor/' + name).sort());
    });
});

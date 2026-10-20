import {execFileSync} from "node:child_process";
import {mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import * as os from "node:os";
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
 *
 * Configs are deliberately split. The five opt-in house-style rules (`max-line-length`,
 * `no-blank-line-after-tsdoc`, `no-parent-import`, `require-tsdoc`,
 * `tsdoc-blank-line-before-tags`) have no JS-side counterpart anymore — the JS implementations
 * under plugin/internal were removed — so oxlint cannot execute them and they must stay out of
 * the corpus comparison entirely. `conformance.carburetorrc.json` turns all five on `error`
 * with the options the fixtures need, and backs the style corpus below (native-only, by
 * design); the comparison corpus derives its own config from that file at run time by
 * stripping the five style entries, because its fixtures do not keep to the house style and
 * would report one-sidedly. The stripped config is written to a temp directory per run, the
 * same pattern the bases tests use.
 */
const ROOT: string = process.cwd();
const NATIVE_BINARY: string = path.join(
    ROOT,
    'native',
    'target',
    'release',
    process.platform === 'win32' ? 'carburetor-lint.exe' : 'carburetor-lint',
);
const NATIVE_STYLE_CONFIG_PATH: string = path.join('native', 'tests', 'fixtures', 'conformance.carburetorrc.json');
const STYLE_CORPUS: readonly string[] = [
    path.join('plugin', '__fixtures__', 'style', 'maxLineLength.ts'),
    path.join('plugin', '__fixtures__', 'style', 'noBlankLineAfterTsdoc.ts'),
    path.join('plugin', '__fixtures__', 'style', 'sub', 'inner.ts'),
    path.join('plugin', '__fixtures__', 'style', 'requireTsdoc.ts'),
    path.join('plugin', '__fixtures__', 'style', 'tsdocBlankLineBeforeTags.ts'),
];

/** The five native-only house-style rules; the JS bridge catalogue excludes them. */
const STYLE_RULES: readonly string[] = [
    'carburetor/max-line-length',
    'carburetor/no-blank-line-after-tsdoc',
    'carburetor/no-parent-import',
    'carburetor/require-tsdoc',
    'carburetor/tsdoc-blank-line-before-tags',
];
const JS_CONFIG: string = path.join('plugin', '__fixtures__', 'oxlintrc.json');
// The comparison corpus derives its config from the style config at run time by stripping the five
// house-style entries (native-only, see the header); written to a temp directory per run.
const NATIVE_CONFIG: string = (() => {
    const config = JSON.parse(readFileSync(NATIVE_STYLE_CONFIG_PATH, 'utf8')) as {rules: Record<string, unknown>};

    for (const rule of STYLE_RULES) {
        delete config.rules[rule];
    }

    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'carburetor-conformance-'));
    const configPath = path.join(tmpDir, 'conformance.carburetorrc.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    return configPath;
})();
const CORPUS: readonly string[] = [
    path.join('plugin', '__fixtures__', 'data', 'allocations.tsx'),
    path.join('plugin', '__fixtures__', 'data', 'reads.tsx'),
    path.join('plugin', '__fixtures__', 'data', 'writes.tsx'),
    path.join('plugin', '__fixtures__', 'lifecycle', 'lifecycle.tsx'),
    path.join('plugin', '__fixtures__', 'operations', 'effects.tsx'),
    path.join('plugin', '__fixtures__', 'operations', 'boundaries.ts'),
    path.join('plugin', '__fixtures__', 'operations', 'oneExport.ts'),
    path.join('plugin', '__fixtures__', 'style', 'preferReadonlyArrayParam.ts'),
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
    const source = readFileSync(path.join(ROOT, 'native', 'src', 'config', 'mod.rs'), 'utf8');
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
        // both configs above specifically so this corpus can prove it fires identically too. The
        // five house-style rules are subtracted: they are native-only now (see the header), so
        // the JS side cannot represent them and their corpus lives in the style test below.
        const catalogue = nativeRegistryRules()
            .map((name) => 'carburetor/' + name)
            .filter((rule) => !STYLE_RULES.includes(rule));

        expect([...seen].sort()).toEqual(catalogue.sort());
    });
});

describe('the native-only style rules over their own corpus', () => {
    /** The binary over the style fixtures, at the style config's severities and options. */
    const styleDiagnostics = (): IDiagnostic[] => {
        const output = runCapturingStdout(
            NATIVE_BINARY,
            ['--config', NATIVE_STYLE_CONFIG_PATH, '--format=json', ...STYLE_CORPUS],
        );

        return (JSON.parse(output) as IDiagnostic[]).map((diagnostic) => ({
            ...diagnostic,
            file: diagnostic.file.replace(/\\/g, '/'),
        }));
    };

    test('every style rule fires, exactly once', () => {
        const diagnostics = styleDiagnostics();

        for (const rule of STYLE_RULES) {
            const reports = diagnostics.filter((diagnostic) => diagnostic.rule === rule);

            expect(reports.length, `${rule} fires exactly once`).toBe(1);
        }
    });

    test('max-line-length reports the one over-limit line the fixture carries', () => {
        // The config caps lines at 200 and counts strings; the fixture holds one 224-character string line.
        const reports = styleDiagnostics().filter(
            (diagnostic) => diagnostic.rule === 'carburetor/max-line-length',
        );

        expect(reports.length).toBe(1);
        expect(reports[0].message).toContain('the maximum is 200');
    });
});

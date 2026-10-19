import {execFileSync, spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import plugin from "@plugin/index.mts";
import {RECOMMENDED} from "@plugin/recommended.mts";
import {NO_HOOKS} from "@plugin/noHooks.mts";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import * as path from "node:path";

const ROOT: string = process.cwd();

/**
 * Proves the 26 carburetor rules work in the host that actually runs them.
 *
 * Detection lives in the native crate now; each rule here is a thin bridge that reports whatever
 * the binary already found (see plugin/src/Utils/Native/nativeBridge.mts). A synthetic RuleTester
 * snippet never touches disk, so it cannot exercise that path at all — this file is what pins the
 * whole thing down instead: the real binary, spawned by the real host, over a real file on disk.
 * native/src/rules/ carries the per-rule edge-case tests; this one is "does it fire, at the right
 * place, through oxlint" for every rule, once each.
 */
const OXLINT: string = path.join(ROOT, 'node_modules', 'oxlint', 'bin', 'oxlint');
const RULE_ID: string = 'carburetor(no-lifecycle-class-property)';

const runOxlint = (args: string[]): string => {
    try {
        return execFileSync(process.execPath, [OXLINT, '-f', 'unix', ...args], {encoding: 'utf8', cwd: ROOT});
    } catch (error) {
        // oxlint exits non-zero when it reports anything, which is the interesting case here.
        const failure = error as {stdout?: string; stderr?: string};

        return `${failure.stdout || ''}${failure.stderr || ''}`;
    }
};

const countOccurrences = (haystack: string, needle: string): number => {
    return haystack.split(needle).length - 1;
};

const diagnosticTriples = (output: string): string[] => output.split(String.fromCharCode(10))
    .filter(line => line.includes('[Error/carburetor(') || line.includes('[Warning/carburetor('))
    .map(line => {
        const fields = line.split(':');
        const rule = line.split('carburetor(')[1].split(')')[0];

        return `${rule},${fields[1]},${fields[2]}`;
    })
    .sort();

/**
 * Pins the shareable oxlint presets against the severity maps the ESLint flat config reads.
 *
 * `recommended.mts` claims the JSON a consumer extends cannot drift from `RECOMMENDED`; this is
 * the test that claim promised. Both hosts must ship the same rule set at the same severities,
 * and every rule the plugin registers needs a preset entry, so adding a rule without wiring its
 * preset line fails here instead of shipping one rule fewer for oxlint users.
 */
const PRESET: string = path.join(ROOT, 'plugin', 'recommended.oxlintrc.json');
const NO_HOOKS_PRESET: string = path.join(ROOT, 'plugin', 'src', 'no-hooks.oxlintrc.json');

/** The JSON preset's `rules`, keyed exactly as the flat-config map keys them. */
const presetRules = (file: string): Record<string, string> => {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {rules: Record<string, string>};

    return parsed.rules;
};

describe('the oxlint presets match the severity maps', () => {
    test('recommended.oxlintrc.json carries exactly the RECOMMENDED severities', () => {
        const rules = presetRules(PRESET);
        const carburetor = Object.fromEntries(Object.entries(rules)
            .filter(([id]) => id.startsWith('carburetor/')));

        expect(carburetor).toEqual(RECOMMENDED);
    });

    test('no-hooks.oxlintrc.json carries exactly the NO_HOOKS severities', () => {
        expect(presetRules(NO_HOOKS_PRESET)).toEqual(NO_HOOKS);
    });

    test('every registered rule has a recommended entry, and nothing else is preset', () => {
        const registered = Object.keys(plugin.rules)
            .map((rule) => `carburetor/${rule}`)
            .sort();
        const recommended = Object.keys(RECOMMENDED).sort();

        expect(registered).toEqual(recommended);
    });

    test('the recommended preset ships only carburetor rules and the oxlint workaround', () => {
        const extra = Object.keys(presetRules(PRESET)).filter((id) => !id.startsWith('carburetor/'));

        expect(extra).toEqual(['typescript/unbound-method']);
        expect(presetRules(PRESET)['typescript/unbound-method']).toBe('off');
    });
});

describe('lint plugin in the oxlint host', () => {
    test('reports the fixture through the real binary', () => {
        const output = runOxlint([
            '-c', 'plugin/__fixtures__/oxlintrc.json',
            'plugin/__fixtures__/lifecycle/lifecycleClassProperty.tsx',
        ]);

        expect(output).toContain(RULE_ID);
        // The violation sits on the class property of BadRow, not on the class or the method.
        expect(output).toContain('lifecycleClassProperty.tsx:5:5');
        // GoodRow declares the same lifecycle as a method and must stay unreported.
        expect(countOccurrences(output, RULE_ID)).toEqual(1);
    });

    test('H21 child handler survives host/native overlaps for both H30 scopes', () => {
        const directory = mkdtempSync(path.join(ROOT, '.tmp-h21-'));
        const fixture = path.join(directory, 'view.tsx');
        const config = path.join(directory, 'oxlintrc.json');
        const plugin = path.relative(directory, path.join(ROOT, 'plugin', 'src', 'index.mts')).replace(/\\/g, '/');

        try {
            writeFileSync(fixture,
                'import {AntiHookComponent} from "react-carburetor";\n' +
                'export class View extends AntiHookComponent { render() { return <Child onClick={() => console.log(1)}/>; } }\n'
            );

            for (const scope of ['all', 'classes']) {
                writeFileSync(config, JSON.stringify({
                    jsPlugins: [plugin],
                    rules: {
                        'carburetor/no-handler-created-in-render': 'warn',
                        'carburetor/require-module-function': ['warn', {scope}],
                    },
                }));
                const hostResult = spawnSync(process.execPath, [OXLINT, '-c', config, '--format', 'json', fixture], {
                    cwd: directory,
                    encoding: 'utf8',
                    env: {...process.env, CARBURETOR_LINT_BIN: path.join(ROOT, 'native', 'target', 'release',
                        process.platform === 'win32' ? 'carburetor-lint.exe' : 'carburetor-lint')},
                });
                expect(hostResult.status).toBe(0, `${hostResult.stdout || ''}${hostResult.stderr || ''}`);
                expect(hostResult.stdout).toContain('"diagnostics"');
                expect(hostResult.stderr).toBe('', `${hostResult.stderr}\n${hostResult.stdout}`);

                const hostDiagnostics = JSON.parse(hostResult.stdout || '') as {
                    diagnostics: {code: string; filename: string}[];
                };

                expect(hostDiagnostics.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
                    'carburetor(no-handler-created-in-render)',
                ]);

                const nativeConfig = path.join(directory, `native-${scope}.json`);
                writeFileSync(nativeConfig, JSON.stringify({rules: {
                    'carburetor/no-handler-created-in-render': 'warn',
                    'carburetor/require-module-function': ['warn', {scope}],
                }}));
                const nativeResult = spawnSync(path.join(ROOT, 'native', 'target', 'release',
                    process.platform === 'win32' ? 'carburetor-lint.exe' : 'carburetor-lint'), [
                    '--config', nativeConfig, '--format=json', '--keep-overlaps', fixture,
                ], {cwd: directory, encoding: 'utf8'});
                expect(nativeResult.status).toBe(0, `${nativeResult.stdout || ''}${nativeResult.stderr || ''}`);
                const nativeDiagnostics = JSON.parse(nativeResult.stdout || '') as {rule: string}[];

                expect(nativeDiagnostics.map(diagnostic => diagnostic.rule)).toEqual([
                    'carburetor/no-handler-created-in-render',
                ]);
            }
        } finally {
            rmSync(directory, {recursive: true, force: true});
        }
    });

    test('H21 function-component hook callbacks survive H30 overlaps for both scopes', () => {
        const directory = mkdtempSync(path.join(ROOT, '.tmp-h21-hooks-'));
        const fixture = path.join(directory, 'view.tsx');
        const config = path.join(directory, 'oxlintrc.json');
        const plugin = path.relative(directory, path.join(ROOT, 'plugin', 'src', 'index.mts')).replace(/\\/g, '/');

        try {
            for (const hookExpression of [
                'useCallback(() => console.log(1), [])',
                'useMemo(() => () => console.log(1), [])',
                'useMemo(() => { return () => console.log(1); }, [])',
            ]) {
                writeFileSync(fixture,
                    `export function Row() { return <Child onSelect={${hookExpression}}/>; }\n`
                );

                for (const scope of ['all', 'classes']) {
                    writeFileSync(config, JSON.stringify({
                    jsPlugins: [plugin],
                    rules: {
                        'carburetor/no-handler-created-in-render': 'warn',
                        'carburetor/require-module-function': ['warn', {scope}],
                    },
                }));
                const hostResult = spawnSync(process.execPath, [OXLINT, '-c', config, '--format', 'json', fixture], {
                    cwd: directory,
                    encoding: 'utf8',
                    env: {...process.env, CARBURETOR_LINT_BIN: path.join(ROOT, 'native', 'target', 'release',
                        process.platform === 'win32' ? 'carburetor-lint.exe' : 'carburetor-lint')},
                });
                expect(hostResult.status).toBe(0, `${hostResult.stdout || ''}${hostResult.stderr || ''}`);
                expect(hostResult.stderr).toBe('', `${hostResult.stderr}\\n${hostResult.stdout}`);

                const hostDiagnostics = JSON.parse(hostResult.stdout || '') as {
                    diagnostics: {code: string}[];
                };

                expect(hostDiagnostics.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
                    'carburetor(no-handler-created-in-render)',
                ]);
                }
            }
        } finally {
            rmSync(directory, {recursive: true, force: true});
        }
    });
    test('H21 conditional component-prop handlers survive H30 overlaps for both scopes', () => {
        const directory = mkdtempSync(path.join(ROOT, '.tmp-h21-conditional-'));
        const fixture = path.join(directory, 'view.tsx');
        const config = path.join(directory, 'oxlintrc.json');
        const plugin = path.relative(directory, path.join(ROOT, 'plugin', 'src', 'index.mts')).replace(/\\/g, '/');

        try {
            for (const source of [
                'export function Row() { return <Child onSelect={enabled ? () => act() : undefined}/>;\n}\nconst enabled = true;\nfunction act() {}\n',
                'export function Row() { return <Child onSelect={enabled && (() => act())}/>;\n}\nconst enabled = true;\nfunction act() {}\n',
                'export function Row() { return <Child onSelect={(enabled ? () => act() : undefined) as Handler}/>;\n}\ntype Handler = (() => void) | undefined;\nconst enabled = true;\nfunction act() {}\n',
                'import {AntiHookComponent} from "react-carburetor";\nexport class View extends AntiHookComponent {\n    render() {\n        return <Child onSelect={(enabled ? () => act() : undefined) as Handler}/>;\n    }\n}\ntype Handler = (() => void) | undefined;\nconst enabled = true;\nfunction act() {}\n',
            ]) {
                writeFileSync(fixture, source);

                for (const scope of ['all', 'classes']) {
                    writeFileSync(config, JSON.stringify({
                        jsPlugins: [plugin],
                        rules: {
                            'carburetor/no-handler-created-in-render': 'warn',
                            'carburetor/require-module-function': ['warn', {scope}],
                        },
                    }));
                    const hostArgs = [OXLINT, '-c', config, '--format', 'json', fixture];
                    const hostResult = spawnSync(process.execPath, hostArgs, {
                        cwd: directory,
                        encoding: 'utf8',
                        env: {...process.env, CARBURETOR_LINT_BIN: path.join(ROOT, 'native', 'target', 'release',
                            process.platform === 'win32' ? 'carburetor-lint.exe' : 'carburetor-lint')},
                    });
                    expect(hostResult.status).toBe(0, `${hostResult.stdout || ''}${hostResult.stderr || ''}`);
                    expect(hostResult.stderr).toBe('', `${hostResult.stderr}\n${hostResult.stdout}`);

                    const hostDiagnostics = JSON.parse(hostResult.stdout || '') as {
                        diagnostics: {code: string}[];
                    };

                    expect(hostDiagnostics.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
                        'carburetor(no-handler-created-in-render)',
                    ]);
                }
            }
        } finally {
            rmSync(directory, {recursive: true, force: true});
        }
    });
    test('every rule in the reads group fires on its fixture', () => {
        const output = runOxlint([
            '-c', 'plugin/__fixtures__/oxlintrc.json',
            'plugin/__fixtures__/data/reads.tsx',
        ]);

        const expected: string[] = [
            'carburetor(no-get-data-in-render)',
            'carburetor(no-computed-get-in-render)',
            'carburetor(no-computed-get-in-computed)',
            'carburetor(no-use-carburetor-outside-render)',
            'carburetor(no-escaping-tracked-data)',
        ];

        // A positive control: a green lint run proves nothing if the rules never see the file.
        expected.forEach((ruleId: string) => {
            expect(countOccurrences(output, ruleId)).toEqual(1);
        });
    });

    test('every rule in the writes group fires on its fixture', () => {
        const output = runOxlint([
            '-c', 'plugin/__fixtures__/oxlintrc.json',
            'plugin/__fixtures__/data/writes.tsx',
        ]);

        const expected: string[] = [
            'carburetor(require-emit-after-draft-write)',
            'carburetor(no-direct-data-write)',
            'carburetor(no-external-data-mutation)',
            'carburetor(no-tracked-data-mutation)',
            'carburetor(no-untrackable-draft-mutation)',
            'carburetor(no-store-write-in-render)',
        ];

        expected.forEach((ruleId: string) => {
            expect(countOccurrences(output, ruleId)).toEqual(1);
        });
    });

    test('every rule in the lifecycle group fires on its fixture', () => {
        const output = runOxlint([
            '-c', 'plugin/__fixtures__/oxlintrc.json',
            'plugin/__fixtures__/lifecycle/lifecycle.tsx',
        ]);

        const expected: string[] = [
            'carburetor(no-lifecycle-class-property)',
            'carburetor(require-super-in-lifecycle)',
            'carburetor(require-bind-for-passed-method)',
            'carburetor(no-handler-created-in-render)',
            'carburetor(max-render-depth)',
        ];

        expected.forEach((ruleId: string) => {
            expect(countOccurrences(output, ruleId)).toEqual(1);
        });
    });

    test('every rule in the effects group fires on its fixture', () => {
        const output = runOxlint([
            '-c', 'plugin/__fixtures__/oxlintrc.json',
            'plugin/__fixtures__/operations/effects.tsx',
        ]);

        const expected: string[] = [
            'carburetor(no-async-effect)',
            'carburetor(no-duplicate-effect-name)',
            'carburetor(require-effect-deps)',
        ];

        expected.forEach((ruleId: string) => {
            expect(countOccurrences(output, ruleId)).toEqual(1);
        });
    });

    test('every rule in the boundaries group fires on its fixture', () => {
        const output = runOxlint([
            '-c', 'plugin/__fixtures__/oxlintrc.json',
            'plugin/__fixtures__/operations/boundaries.ts',
        ]);

        const expected: string[] = [
            'carburetor(no-async-transaction)',
            'carburetor(no-module-level-store)',
            'carburetor(no-untrackable-store-data)',
            'carburetor(require-subscription-disposal)',
        ];

        expected.forEach((ruleId: string) => {
            expect(countOccurrences(output, ruleId)).toEqual(1);
        });
    });

    test('H29 fires on both allocation closures while H31 covers only the distinct spot', () => {
        const output = runOxlint([
            '-c', 'plugin/__fixtures__/oxlintrc.json',
            'plugin/__fixtures__/data/allocations.tsx',
        ]);

        expect(countOccurrences(output, 'carburetor(require-method-for-closure)')).toEqual(2);
        // H31 only fires on the per-item handler (26:68); the arrow spots it shares with H29 stay deduplicated.
        expect(countOccurrences(output, 'carburetor(no-function-in-render)')).toEqual(1);
    });

    test('H31 reports when H29 and H30 are off', () => {
        const output = runOxlint([
            '-c', 'plugin/__fixtures__/consumer/overlaps/overlaps.oxlintrc.json',
            'plugin/__fixtures__/consumer/overlaps/overlaps.component.jsx',
        ]);

        expect(countOccurrences(output, 'carburetor(no-function-in-render)')).toEqual(1);
        expect(output).not.toContain('require-method-for-closure');
        expect(output).not.toContain('require-module-function');
    });

    test('H30 covers the uncaptured map callback and H31 yields to it', () => {
        const output = runOxlint([
            '-c', 'plugin/__fixtures__/oxlintrc.json',
            'plugin/__fixtures__/data/allocations.tsx',
        ]);

        // H30 reports the map callback of DedupCells (64:31); H31 covers the same spot and,
        // with H30 enabled, reports only its distinct one (26:68).
        expect(countOccurrences(output, 'carburetor(require-module-function)')).toEqual(5);
        expect(countOccurrences(output, 'carburetor(no-function-in-render)')).toEqual(1);
    });

    test('H31 reports the map callback when H30 is off', () => {
        const output = runOxlint([
            '-c', 'plugin/__fixtures__/consumer/overlaps/noAllocationRules.oxlintrc.json',
            'plugin/__fixtures__/data/allocations.tsx',
        ]);

        // Without H30 the spots would be lost if H31 still yielded, so it reports every one it
        // covers: the two arrows H29 owns (12:33, 26:31) plus both map callbacks (26:68, 64:31).
        expect(countOccurrences(output, 'carburetor(no-function-in-render)')).toEqual(4);
        expect(output).not.toContain('require-module-function');
    });

    test('H32 fires on the capturing update callback and spares the bare method reference', () => {
        const output = runOxlint([
            '-c', 'plugin/__fixtures__/oxlintrc.json',
            'plugin/__fixtures__/data/allocations.tsx',
        ]);

        expect(countOccurrences(output, 'carburetor(no-closure-in-update)')).toEqual(1);
        expect(output).toContain('allocations.tsx:52:21');
        expect(output).toContain('allocations.tsx:41:21');
        expect(output).not.toContain('allocations.tsx:52:21: warning: [carburetor(no-closure-in-update)]');
    });

    test('the scope option narrows H30 to class members', () => {
        const scoped = runOxlint([
            '-c', 'plugin/__fixtures__/consumer/overlaps/scope.oxlintrc.json',
            'plugin/__fixtures__/data/allocations.tsx',
        ]);

        // The class members stay (16:5, 29:5, 64:31); the module-function one (71:12) is dropped.
        expect(countOccurrences(scoped, 'carburetor(require-module-function)')).toEqual(4);
        expect(scoped).toContain('allocations.tsx:64:31');
        expect(scoped).not.toContain('allocations.tsx:71:12');
    });

    test('function-component render allocation and store memo rules reach the host', () => {
        const output = runOxlint([
            '-c', 'plugin/__fixtures__/oxlintrc.json',
            'plugin/__fixtures__/function-components.tsx',
        ]);

        const expected = [
            'no-capturing-hook-selector,13,48',
            'no-memo-over-store-read,12,22',
            'no-memo-over-store-read,23,21',
            'no-react-hooks-in-components,12,22',
            'no-react-hooks-in-components,23,21',
            'no-function-in-render,10,24',
            'no-function-in-render,11,19',
            'no-function-in-render,12,36',
            'no-handler-created-in-render,14,19',
            'require-module-function,22,45',
        ].sort();

        expect(diagnosticTriples(output)).toEqual(expected);
    });

    test('round three scalar memo prop keeps exactly H30', () => {
        const directory = mkdtempSync(path.join(ROOT, '.tmp-h30-scalar-'));
        const fixture = path.join(directory, 'view.tsx');
        const config = path.join(directory, 'oxlintrc.json');
        const plugin = path.relative(directory, path.join(ROOT, 'plugin', 'src', 'index.mts')).replace(/\\/g, '/');

        try {
            const factories = [
                'useMemo(() => 42, [])',
                'useMemo(() => { return 42; }, [])',
            ];
            writeFileSync(config, JSON.stringify({
                jsPlugins: [plugin],
                rules: {
                    'carburetor/no-handler-created-in-render': 'warn',
                    'carburetor/require-module-function': ['warn', {scope: 'all'}],
                    'carburetor/no-function-in-render': 'warn',
                },
            }));

            for (const factory of factories) {
                writeFileSync(fixture, `export function Row() { return <Child value={${factory}}/>; }\n`);
                const hostResult = spawnSync(process.execPath, [OXLINT, '-c', config, '--format', 'json', fixture], {
                    cwd: directory,
                    encoding: 'utf8',
                    env: {...process.env, CARBURETOR_LINT_BIN: path.join(ROOT, 'native', 'target', 'release',
                        process.platform === 'win32' ? 'carburetor-lint.exe' : 'carburetor-lint')},
                });
                expect(hostResult.status).toBe(0, `${hostResult.stdout || ''}${hostResult.stderr || ''}`);
                const hostDiagnostics = JSON.parse(hostResult.stdout || '') as {diagnostics: {code: string}[]};

                expect(hostDiagnostics.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
                    'carburetor(require-module-function)',
                ]);
            }
        } finally {
            rmSync(directory, {recursive: true, force: true});
        }
    });

    test('round four allocation ownership reports the exact rules', () => {
        const directory = mkdtempSync(path.join(ROOT, '.tmp-round-four-'));
        const fixture = path.join(directory, 'view.tsx');
        const config = path.join(directory, 'oxlintrc.json');
        const plugin = path.relative(directory, path.join(ROOT, 'plugin', 'src', 'index.mts')).replace(/\\/g, '/');

        try {
            writeFileSync(config, JSON.stringify({
                jsPlugins: [plugin],
                rules: {
                    'carburetor/no-handler-created-in-render': 'warn',
                    'carburetor/no-function-in-render': 'warn',
                    'carburetor/require-module-function': ['warn', {scope: 'all'}],
                },
            }));
            const cases: [string, string[]][] = [
                ['export function Row({id}) { const handler = () => select(id); return <Child onSelect={useCallback(handler, [id])}/>; }', ['carburetor(no-function-in-render)']],
                ['export function Row({id}) { const handler = () => select(id); return <Child onSelect={useMemo(() => handler, [id])}/>; }', ['carburetor(no-function-in-render)']],
                ['export function Row() { const handler = () => globalHandler(); return <Child onSelect={useCallback(handler, [])}/>; }', ['carburetor(require-module-function)']],
                ['export function Row() { const handler = () => globalHandler(); return <Child onSelect={useMemo(() => handler, [])}/>; }', ['carburetor(require-module-function)']],
                ['export function Row() { return <Child onSelect={useCallback(() => globalHandler(), [])}/>; }', ['carburetor(no-handler-created-in-render)']],
                ['export function Row() { return <Child onSelect={useMemo(() => () => globalHandler(), [])}/>; }', ['carburetor(no-handler-created-in-render)']],
                ['export function Row({id}) { return <Child onSelect={() => select(id)}/>; }', ['carburetor(no-handler-created-in-render)']],
            ];

            for (const [source, expected] of cases) {
                writeFileSync(fixture, `${source}\n`);
                const result = spawnSync(process.execPath, [OXLINT, '-c', config, '--format', 'json', fixture], {
                    cwd: directory,
                    encoding: 'utf8',
                    env: {...process.env, CARBURETOR_LINT_BIN: path.join(ROOT, 'native', 'target', 'release',
                        process.platform === 'win32' ? 'carburetor-lint.exe' : 'carburetor-lint')},
                });
                expect(result.status).toBe(0, `${result.stdout || ''}${result.stderr || ''}`);
                const diagnostics = JSON.parse(result.stdout || '') as {diagnostics: {code: string}[]};
                const expectedSet = [...expected].sort();

                expect(diagnostics.diagnostics.map(diagnostic => diagnostic.code).sort()).toEqual(expectedSet);
            }
        } finally {
            rmSync(directory, {recursive: true, force: true});
        }
    });

    test('the repository config loads the plugin', () => {
        const output = runOxlint(['-c', '.oxlintrc.json', 'plugin/src/index.mts']);

        expect(output).not.toContain('Failed to load JS plugin');
        expect(output).not.toContain('Failed to parse oxlint configuration file');
        expect(output).not.toContain(RULE_ID);
    });
});

import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {describe, expect, rstest, test} from "@rstest/core";
import {createRequire} from "node:module";
import {basesConfig} from "@plugin/Utils/NativeBases.mts";
import {writeAtomic} from "@plugin/Utils/atomicWrite.mts";
import {runNative} from "@plugin/Utils/Native/nativeBridge.mts";

/**
 * The custom-base path end to end: base-class lists from the host's `settings.carburetor` (or the
 * project's `.carburetorrc.json`) must reach the native binary through the bridge's `--config`
 * file, so `class Screen extends MyBase` lints the same through oxlint as through the CLI.
 *
 * The unit part pins what `basesConfig` writes and how the key separates runs; the spawn-stubbed
 * part proves `runNative` keys its caches and lock files by that key; the last part runs the real
 * oxlint and the real binary over the same fixture and compares.
 */
const ROOT: string = process.cwd();

/** The mock above hides `node:child_process` from this whole file; the e2e part needs the real one. */
const realSpawnSync = createRequire(import.meta.url)('node:child_process').spawnSync as typeof spawnSync;

/** The bridge's shared config directory; files there are never deleted, only added. */
const BRIDGE_CONFIG_DIR = path.join(os.tmpdir(), 'carburetor-lint-bridge');

/** The lock directory the bridge keeps its lock/result files in; ours are removed by the tests. */
const BRIDGE_DIR = path.join(os.tmpdir(), 'carburetor-lint');

/**
 * Whether the local binary already knows the `componentBases`/`storeBases` config keys.
 *
 * The checked-out binary can be older than the sources (CI builds the fresh one), and an old
 * binary rejects the bridge's bases config with exit 2, so the end-to-end parts that depend on
 * a bases-aware binary probe for support once and step aside locally; CI, with a fresh binary,
 * runs them for real.
 */
const supportsBases = ((): boolean => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'carburetor-bases-probe-'));

    try {
        const config = path.join(dir, 'probe.carburetorrc.json');

        writeFileSync(config, JSON.stringify({componentBases: ['__Probe__']}));

        const run = realSpawnSync(
            path.join(ROOT, 'native', 'target', 'release',
                process.platform === 'win32' ? 'carburetor-lint.exe' : 'carburetor-lint'),
            ['--config', config, '--format=json'],
            {cwd: ROOT, encoding: 'utf8'},
        );

        return !(run.status === 2 && run.stderr.includes('unknown key'));
    } finally {
        rmSync(dir, {recursive: true, force: true});
    }
})();

type TNativeSpawn = typeof spawnSync;

const nativeSpawn = rstest.hoisted(() => rstest.fn<TNativeSpawn>());

rstest.mock('node:child_process', () => ({spawnSync: nativeSpawn}));

/** The lock path `runNative` would use for this cwd and base key, mirroring its digest formula. */
const lockPathFor = (cwd: string, key: string): string => {
    const digest = createHash('sha256').update(`${cwd}\u0000${key}`).digest('hex').slice(0, 32);

    return path.join(BRIDGE_DIR, `${process.pid}-${digest}.lock`);
};

describe('basesConfig', () => {
    test('lists from settings reach the config file verbatim, with a non-empty key', () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-bases-'));

        try {
            const {config, key} = basesConfig(cwd, {carburetor: {
                componentBases: ['MyBase'], storeBases: ['UsersCache'],
            }});

            expect(existsSync(config)).toBe(true);
            expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual({
                componentBases: ['MyBase'], storeBases: ['UsersCache'],
            });
            expect(key).not.toBe('');
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test('different base lists produce different keys', () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-bases-'));

        try {
            const first = basesConfig(cwd, {carburetor: {componentBases: ['A']}});
            const second = basesConfig(cwd, {carburetor: {componentBases: ['B']}});
            const third = basesConfig(cwd, {carburetor: {componentBases: ['A'], storeBases: ['S']}});

            expect(first.key).not.toBe(second.key);
            expect(first.key).not.toBe(third.key);
            expect(second.key).not.toBe(third.key);
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test.each([
        ['a bare string', 'X'],
        ['a number entry', [1]],
        ['an empty-string entry', ['']],
    ])('malformed settings (%s) fail loudly instead of silently narrowing the run', (_label, value) => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-bases-'));

        try {
            expect(() => basesConfig(cwd, {carburetor: {componentBases: value}}))
                .toThrow('settings.carburetor.componentBases must be an array of non-empty base class names.');
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test('without settings, the lists come from the project .carburetorrc.json, base keys only', () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-bases-'));

        try {
            writeFileSync(path.join(cwd, '.carburetorrc.json'), JSON.stringify({
                componentBases: ['Rc'],
                'require-module-function': [{'scope': 'classes'}], // per-rule options must not pass
            }));

            const {config} = basesConfig(cwd);

            expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual({componentBases: ['Rc'], storeBases: []});
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test.each([
        ['a bare string', 'X'],
        ['a number entry', [1]],
        ['an empty-string entry', ['']],
    ])('a malformed rc list (%s) fails loudly, as in the CLI', (_label, value) => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-bases-rc-'));

        try {
            writeFileSync(path.join(cwd, '.carburetorrc.json'), JSON.stringify({componentBases: value}));

            expect(() => basesConfig(cwd)).toThrow('componentBases" must be an array of non-empty base class names');
            expect(() => basesConfig(cwd)).toThrow(path.join(cwd, '.carburetorrc.json'));
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test.each([
        ['broken JSON', '{not json'],
        ['a top-level array', '["MyBase"]'],
        ['a malformed list value', '{"componentBases": "MyBase"}'],
        ['a malformed list entry', '{"storeBases": 42}'],
    ])('an unreadable rc (%s) is an error, not a silent fallback', (_label, content) => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-bases-rc-'));

        try {
            writeFileSync(path.join(cwd, '.carburetorrc.json'), content);

            expect(() => basesConfig(cwd)).toThrow(path.join(cwd, '.carburetorrc.json'));
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test('an absent rc is the shared neutral config (control)', () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-bases-'));

        try {
            const {config, key} = basesConfig(cwd);

            expect(key).toBe('');
            expect(config).toBe(path.join(BRIDGE_CONFIG_DIR, 'bridge.carburetorrc.json'));
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test('base lists are canonized: order and duplicates do not change the key or the file', () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-bases-'));

        try {
            const first = basesConfig(cwd, {carburetor: {componentBases: ['MyBase', 'Alpha']}});
            const second = basesConfig(cwd, {carburetor: {componentBases: ['Alpha', 'MyBase']}});
            const duplicated = basesConfig(cwd, {carburetor: {componentBases: ['A', 'A']}});
            const single = basesConfig(cwd, {carburetor: {componentBases: ['A']}});

            expect(first.key).toBe(second.key);
            expect(first.config).toBe(second.config);
            expect(duplicated.key).toBe(single.key);
            expect(JSON.parse(readFileSync(first.config, 'utf8')))
                .toEqual({componentBases: ['Alpha', 'MyBase'], storeBases: []});
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test('with no settings and no rc, the shared neutral config is reused', () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-bases-'));

        try {
            const {config, key} = basesConfig(cwd);

            expect(key).toBe('');
            expect(config).toBe(path.join(BRIDGE_CONFIG_DIR, 'bridge.carburetorrc.json'));
            expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual({});
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });
});

/** The result path for an existing `lock`, mirroring `resultPathFor` in the bridge. */
const resultPathFor = (lock: string): string => {
    const stat = statSync(lock);

    return lock.replace(/\.lock$/, `.${stat.dev.toString(36)}${stat.ino.toString(36)}.json`);
};

/** A stub whose reply names the base set it was run with, read from the `--config` file itself. */
const stubPerBaseNative = (): void => {
    nativeSpawn.mockImplementation((_command, args) => {
        const configPath = (args as readonly string[])[(args as readonly string[]).indexOf('--config') + 1] as string;
        const base = (JSON.parse(readFileSync(configPath, 'utf8')) as {componentBases: string[]}).componentBases[0];

        return {
            stdout: JSON.stringify([
                {rule: 'stub', file: './a.ts', line: 1, column: 1, message: `stub finding ${base}`, severity: 'error'},
            ]),
            stderr: '', status: 0, error: undefined,
        } as ReturnType<TNativeSpawn>;
    });
};

describe('basesConfig ruleOptions', () => {
    test('settings.carburetor.ruleOptions reach the config file as ["error", options] per rule', () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-ruleopts-'));

        try {
            const {config, key} = basesConfig(cwd, {carburetor: {ruleOptions: {
                'no-parent-import': {roots: [{'path': 'lib/src', 'prefix': '@/'}]},
                'require-tsdoc': {'requireParamDocs': true},
            }}});

            expect(existsSync(config)).toBe(true);
            expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual({
                componentBases: [],
                storeBases: [],
                rules: {
                    'carburetor/no-parent-import': ['error', {roots: [{'path': 'lib/src', 'prefix': '@/'}]}],
                    'carburetor/require-tsdoc': ['error', {'requireParamDocs': true}],
                },
            });
            expect(key).not.toBe('');
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test('an empty ruleOptions changes nothing: the config keeps its previous exact shape', () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-ruleopts-'));

        try {
            const neutral = basesConfig(cwd);
            const empty = basesConfig(cwd, {carburetor: {ruleOptions: {}}});

            expect(JSON.parse(readFileSync(empty.config, 'utf8'))).toEqual({});
            expect(empty.key).toBe('');
            expect(empty.config).toBe(neutral.config);

            const withBases = basesConfig(cwd, {carburetor: {componentBases: ['A'], ruleOptions: {}}});

            expect(JSON.parse(readFileSync(withBases.config, 'utf8')))
                .toEqual({componentBases: ['A'], storeBases: []});
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test('ruleOptions are part of the content hash: different options, different keys', () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-ruleopts-'));

        try {
            const first = basesConfig(cwd, {carburetor: {ruleOptions: {'max-line-length': {'code': 80}}}});
            const second = basesConfig(cwd, {carburetor: {ruleOptions: {'max-line-length': {'code': 100}}}});
            const same = basesConfig(cwd, {carburetor: {ruleOptions: {'max-line-length': {'code': 80}}}});

            expect(first.key).not.toBe(second.key);
            expect(first.key).toBe(same.key);
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test.each([
        ['a bare string', 'X'],
        ['an array', []],
        ['a non-object entry', {'require-tsdoc': true}],
        ['a null entry', {'require-tsdoc': null}],
    ])('malformed ruleOptions (%s) fail loudly, like the base lists', (_label, value) => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-ruleopts-'));

        try {
            expect(() => basesConfig(cwd, {carburetor: {ruleOptions: value as unknown}}))
                .toThrow('settings.carburetor.ruleOptions');
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });
});

describe('writeAtomic', () => {
    test('a failed write throws the original error and leaves no temp file behind', () => {
        const dir = mkdtempSync(path.join(os.tmpdir(), 'carburetor-atomic-'));

        try {
            expect(() => writeAtomic(path.join(dir, 'no-such-dir', 'f.json'), '{}'))
                .toThrow(/no such file or directory/i);
            expect(existsSync(path.join(dir, 'no-such-dir'))).toBe(false);
        } finally {
            rmSync(dir, {recursive: true, force: true});
        }
    });

    test('a successful write lands the content at the target (control)', () => {
        const dir = mkdtempSync(path.join(os.tmpdir(), 'carburetor-atomic-'));
        const target = path.join(dir, 'f.json');

        try {
            writeAtomic(target, '{"ok":true}');

            expect(readFileSync(target, 'utf8')).toBe('{"ok":true}');
        } finally {
            rmSync(dir, {recursive: true, force: true});
        }
    });
});

describe('runNative cache separation by base key', () => {
    test('different base lists spawn fresh runs, the same list reuses the cached one', () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-bases-one-'));
        const settingsA = {carburetor: {componentBases: ['A']}};
        const settingsB = {carburetor: {componentBases: ['B']}};
        const {key: keyA} = basesConfig(cwd, settingsA);
        const lockA = lockPathFor(cwd, keyA);

        try {
            stubPerBaseNative();
            const spawnsBefore = nativeSpawn.mock.calls.length;

            // One project, three calls: each answer must name its own base set, proving neither
            // the lock digest, the module cache nor the published result leak across base keys.
            expect(runNative(cwd, () => 'stub', undefined, undefined, settingsA)[0].message).toBe('stub finding A');
            expect(runNative(cwd, () => 'stub', undefined, undefined, settingsB)[0].message).toBe('stub finding B');
            expect(runNative(cwd, () => 'stub', undefined, undefined, settingsA)[0].message).toBe('stub finding A');

            // A then B each spawned; the return to A was served from the module cache, which must
            // therefore be keyed by the base key.
            expect(nativeSpawn.mock.calls.length).toBe(spawnsBefore + 2);

            // The lock file names the base key in its digest, so two base sets in one project
            // never elect over each other's lock.
            expect(existsSync(lockA)).toBe(true);
        } finally {
            rmSync(resultPathFor(lockA), {force: true});
            rmSync(lockA, {force: true});
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test('the same unsaved buffer is analyzed per base set, not shared across them', () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-bases-buf-'));
        const settingsA = {carburetor: {componentBases: ['A']}};
        const settingsB = {carburetor: {componentBases: ['B']}};
        const file = path.join(cwd, 'a.ts');

        try {
            stubPerBaseNative();
            const spawnsBefore = nativeSpawn.mock.calls.length;

            // The disk content differs from both buffers, so both take the in-memory path.
            writeFileSync(file, 'export const saved = 1;');

            const buffer = 'export const unsaved = 1;';

            expect(runNative(cwd, () => 'stub', file, buffer, settingsA)[0].message).toBe('stub finding A');
            expect(runNative(cwd, () => 'stub', file, buffer, settingsB)[0].message).toBe('stub finding B');
            expect(runNative(cwd, () => 'stub', file, buffer, settingsA)[0].message).toBe('stub finding A');

            // Same filename and text: only the base key tells the entries apart, so B re-ran
            // and the return to A was served from A's own entry.
            expect(nativeSpawn.mock.calls.length).toBe(spawnsBefore + 2);
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });
});

test('a file saved after a waiter-accepted result is re-scanned, never answered from the file', () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-bases-fresh-'));
    const settingsA = {carburetor: {componentBases: ['A']}};
    const settingsB = {carburetor: {componentBases: ['B']}};
    const {key: keyA} = basesConfig(cwd, settingsA);
    const {key: keyB} = basesConfig(cwd, settingsB);
    const lockA = lockPathFor(cwd, keyA);
    const lockB = lockPathFor(cwd, keyB);
    const file = path.join(cwd, 'a.ts');
    const text = 'export const a = 1;';
    let resultA = '';

    try {
        stubPerBaseNative();

        // A real runner elects, spawns and publishes its result file.
        runNative(cwd, () => 'stub', undefined, undefined, settingsA);
        resultA = resultPathFor(lockA);
        const spawnsAfterRunner = nativeSpawn.mock.calls.length;

        // A second base set arrives after its runner: a waiter, reading the file result.
        writeFileSync(lockB, '');
        writeFileSync(resultPathFor(lockB), JSON.stringify([
            {rule: 'stub', file: './a.ts', line: 1, column: 1, message: 'stale file answer', severity: 'error'},
        ]));

        expect(runNative(cwd, () => 'stub', undefined, undefined, settingsB)[0].message).toBe('stale file answer');
        expect(nativeSpawn.mock.calls.length).toBe(spawnsAfterRunner);

        // Saved after both runs: a scan from either moment no longer describes this file.
        writeFileSync(file, text);

        const fresh = runNative(cwd, () => 'stub', file, text, settingsA);

        expect(fresh[0].message).toBe('stub finding A');
        // The stale file answer must not come back: the waiter result forced a scan in this thread.
        expect(nativeSpawn.mock.calls.length).toBe(spawnsAfterRunner + 1);
    } finally {
        rmSync(resultPathFor(lockB), {force: true});
        rmSync(lockA, {force: true});
        rmSync(lockB, {force: true});
        rmSync(resultA, {force: true});
        rmSync(cwd, {recursive: true, force: true});
    }
});

describe('the custom base, through the real host and the real binary', () => {
    const FIXTURE = path.join('plugin', '__fixtures__', 'lifecycle', 'bases.tsx');
    const runOxlint = (config: string): string => realSpawnSync(
        process.execPath,
        [path.join('node_modules', 'oxlint', 'bin', 'oxlint'), '-f', 'unix', '-c', config, FIXTURE],
        {cwd: ROOT, encoding: 'utf8'},
    ).stdout || '';

    test('with settings.carburetor.componentBases, oxlint reports the MyBase subclass', () => {
        // A binary older than the sources cannot accept the bases config; the fresh CI binary runs this.
        if (!supportsBases) {
            return;
        }

        const output = runOxlint(path.join('__tests__', 'Plugin', 'fixtures', 'basesOn.oxlintrc.json'));

        expect(output).toContain('require-super-in-lifecycle');
        expect(output).toContain('bases.tsx:');
    });

    test('without settings the same fixture is clean (control)', () => {
        const output = runOxlint(path.join('__tests__', 'Plugin', 'fixtures', 'basesOff.oxlintrc.json'));

        expect(output).not.toContain('require-super-in-lifecycle');
    });

    test('the plugin result matches the native CLI run over the same config', () => {
        // Same guard as above: this comparison needs a binary that knows the bases config keys.
        if (!supportsBases) {
            return;
        }

        const dir = mkdtempSync(path.join(os.tmpdir(), 'carburetor-bases-cli-'));
        const config = path.join(dir, 'bases.carburetorrc.json');

        try {
            writeFileSync(config, JSON.stringify({componentBases: ['MyBase']}));

            // Exit code 1 means "problems found"; the JSON on stdout is the comparison target.
            const run = realSpawnSync(
                path.join(ROOT, 'native', 'target', 'release',
                    process.platform === 'win32' ? 'carburetor-lint.exe' : 'carburetor-lint'),
                ['--config', config, '--format=json', '--rule', 'carburetor/require-super-in-lifecycle=error',
                    FIXTURE],
                {cwd: ROOT, encoding: 'utf8'},
            );
            const diagnostics = (JSON.parse(run.stdout) as
                {file: string; line: number; column: number; message: string; rule: string}[])
                .filter(diagnostic => diagnostic.rule === 'carburetor/require-super-in-lifecycle');

            expect(diagnostics.length).toBe(1);

            const oxlintOutput = runOxlint(path.join('__tests__', 'Plugin', 'fixtures', 'basesOn.oxlintrc.json'));

            // The plugin's unix output pins the same position the CLI's JSON names.
            expect(oxlintOutput).toContain(`bases.tsx:${diagnostics[0].line}:${diagnostics[0].column}`);
            expect(diagnostics[0].message).toContain('super');
        } finally {
            rmSync(dir, {recursive: true, force: true});
        }
    });
});

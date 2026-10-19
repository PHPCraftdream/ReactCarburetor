import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {describe, expect, rstest, test} from "@rstest/core";
import {createRequire} from "node:module";
import {basesConfig} from "@plugin/Utils/NativeBases.mts";
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

/** A successful one-diagnostic run, so a caching test only counts spawns, not outcomes. */
const stubSuccessfulNative = (): void => {
    nativeSpawn.mockImplementation(() =>
        ({
            stdout: JSON.stringify([
                {rule: 'stub', file: './a.ts', line: 1, column: 1, message: 'stub finding', severity: 'error'},
            ]),
            stderr: '', status: 0, error: undefined,
        }) as ReturnType<TNativeSpawn>);
};

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
                storeBases: 42, // malformed rc values are skipped leniently, only in the rc
                'require-module-function': [{'scope': 'classes'}], // per-rule options must not pass
            }));

            const {config} = basesConfig(cwd);

            expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual({componentBases: ['Rc'], storeBases: []});
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

describe('runNative cache separation by base key', () => {
    test('different base lists spawn fresh runs, the same list reuses the cached one', () => {
        const cwdA = mkdtempSync(path.join(os.tmpdir(), 'carburetor-bases-a-'));
        const cwdB = mkdtempSync(path.join(os.tmpdir(), 'carburetor-bases-b-'));
        const settingsA = {carburetor: {componentBases: ['A']}};
        const settingsB = {carburetor: {componentBases: ['B']}};
        const {key: keyA} = basesConfig(cwdA, settingsA);
        const lockA = lockPathFor(cwdA, keyA);
        const resultA = `${lockA.replace(/\.lock$/, '')}.result.json`;

        try {
            stubSuccessfulNative();

            const first = runNative(cwdA, () => 'stub', undefined, undefined, settingsA);
            const second = runNative(cwdB, () => 'stub', undefined, undefined, settingsB);
            const third = runNative(cwdA, () => 'stub', undefined, undefined, settingsA);

            expect(second).toEqual(first);
            expect(third).toEqual(first);

            // Two distinct base sets meant two distinct binaries runs; the repeat of the first set
            // was served from the module cache, which must therefore be keyed by the base key.
            expect(nativeSpawn).toHaveBeenCalledTimes(2);

            const argsOf = (call: number): readonly string[] => nativeSpawn.mock.calls[call][1] as readonly string[];
            const configOf = (call: number): string => {
                const args = argsOf(call);

                expect(args).toContain('--config');

                return args[args.indexOf('--config') + 1] as string;
            };

            expect(configOf(0)).not.toBe(configOf(1));
            expect(configOf(0)).toBe(basesConfig(cwdA, settingsA).config);

            // The lock file names the base key in its digest, so two base sets in one process
            // never elect over each other's lock.
            expect(existsSync(lockA)).toBe(true);
        } finally {
            rmSync(lockA, {force: true});
            rmSync(resultA, {force: true});
            rmSync(cwdA, {recursive: true, force: true});
            rmSync(cwdB, {recursive: true, force: true});
        }
    });
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
            const diagnostics = JSON.parse(run.stdout) as
                {file: string; line: number; column: number; message: string}[];

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

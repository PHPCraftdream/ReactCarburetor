import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import {beforeAll, describe, expect, rstest, test} from "@rstest/core";
import {basesConfig} from "@plugin/Utils/NativeBases.mts";
import {runNative} from "@plugin/Utils/Native/nativeBridge.mts";

/**
 * The functional-class rules through the bridge: the project's `classes` section reaches the
 * binary with the project as root, a stylesheet edit makes cached answers stale, and the markup
 * rule reports through the real oxlint and the real binary.
 */
const ROOT: string = process.cwd();

/** The mock below hides `node:child_process` from this whole file; the e2e part needs the real one. */
const realSpawnSync = createRequire(import.meta.url)('node:child_process').spawnSync as typeof spawnSync;

/** The lock directory the bridge keeps its lock/result files in; ours are removed by the tests. */
const BRIDGE_DIR = path.join(os.tmpdir(), 'carburetor-lint');

/** The compiled binary the real-binary part runs; CI builds it before the tests. */
const NATIVE_BINARY: string = path.join(ROOT, 'native', 'target', 'release',
    process.platform === 'win32' ? 'carburetor-lint.exe' : 'carburetor-lint');

type TNativeSpawn = typeof spawnSync;

const nativeSpawn = rstest.hoisted(() => rstest.fn<TNativeSpawn>());

rstest.mock('node:child_process', () => ({spawnSync: nativeSpawn}));
// The handshake has its own tests and would add a --version call to the counted spawns.
rstest.mock('@plugin/Utils/assertProtocol.mts', () => ({assertProtocol: () => undefined}));

/** The lock path `runNative` would use for this cwd and base key, mirroring its digest formula. */
const lockPathFor = (cwd: string, key: string): string => {
    const digest = createHash('sha256').update(`${cwd}\u0000${key}`).digest('hex').slice(0, 32);

    return path.join(BRIDGE_DIR, `${process.pid}-${digest}.lock`);
};

/** The result file the lock winner published next to its lock. */
const resultPathFor = (lock: string): string => {
    const stat = statSync(lock);

    return lock.replace(/\.lock$/, `.${stat.dev.toString(36)}${stat.ino.toString(36)}.json`);
};

/** A stub that answers every run with one finding. */
const stubNative = (): void => {
    nativeSpawn.mockImplementation(() => ({
        stdout: JSON.stringify([
            {rule: 'stub', file: './a.ts', line: 1, column: 1, message: 'stub finding', severity: 'error'},
        ]),
        stderr: '', status: 0, error: undefined,
    }) as ReturnType<TNativeSpawn>);
};

describe('basesConfig and the classes section', () => {
    test('the rc classes section reaches the config with the project as root, with or without settings', () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-bases-'));
        const classes = {css: ['src/**/*.css'], families: ['brand']};

        try {
            writeFileSync(path.join(cwd, '.carburetorrc.json'), JSON.stringify({classes}));

            const fromRc = basesConfig(cwd);
            const fromSettings = basesConfig(cwd, {carburetor: {componentBases: ['Screen']}});

            expect(JSON.parse(readFileSync(fromRc.config, 'utf8')))
                .toEqual({componentBases: [], storeBases: [], classes, root: path.resolve(cwd)});
            expect(JSON.parse(readFileSync(fromSettings.config, 'utf8')))
                .toEqual({componentBases: ['Screen'], storeBases: [], classes, root: path.resolve(cwd)});
            expect(fromRc.key).not.toBe('');
            expect(fromRc.key).not.toBe(fromSettings.key);
            expect(fromRc.stylesheets).toEqual(['src/**/*.css']);
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test('without the section there are no stylesheets to watch', () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-bases-'));

        try {
            expect(basesConfig(cwd).stylesheets).toEqual([]);
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });
});

describe('runNative freshness against the classes stylesheets', () => {
    /** A project whose rc names one stylesheet, last modified a minute ago. */
    const styledProject = (): {cwd: string; sheet: string} => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-bases-css-'));
        const sheet = path.join(cwd, 'styles', 'app.css');
        const past = new Date(Date.now() - 60_000);

        mkdirSync(path.join(cwd, 'styles'));
        writeFileSync(path.join(cwd, '.carburetorrc.json'), JSON.stringify({classes: {css: ['styles/*.css']}}));
        writeFileSync(sheet, '@layer components {}');
        utimesSync(sheet, past, past);

        return {cwd, sheet};
    };

    /** Marks the stylesheet edited after any run this test made. */
    const touch = (sheet: string): void => {
        const later = new Date(Date.now() + 60_000);

        utimesSync(sheet, later, later);
    };

    test('a stylesheet edited after the cached run makes the next answer a re-scan', () => {
        const {cwd, sheet} = styledProject();
        const settings = {carburetor: {componentBases: ['A']}};
        const lock = lockPathFor(cwd, basesConfig(cwd, settings).key);

        try {
            stubNative();
            const before = nativeSpawn.mock.calls.length;

            runNative(cwd, () => 'stub', undefined, undefined, settings);
            runNative(cwd, () => 'stub', undefined, undefined, settings);
            // The stylesheet predates the run: the second answer is the cached one.
            expect(nativeSpawn.mock.calls.length).toBe(before + 1);

            touch(sheet);
            runNative(cwd, () => 'stub', undefined, undefined, settings);
            expect(nativeSpawn.mock.calls.length).toBe(before + 2);
        } finally {
            rmSync(resultPathFor(lock), {force: true});
            rmSync(lock, {force: true});
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test('an unsaved buffer is re-checked after a stylesheet edit, not answered from its cache', () => {
        const {cwd, sheet} = styledProject();
        const settings = {carburetor: {componentBases: ['A']}};
        const file = path.join(cwd, 'a.tsx');
        const buffer = 'export const unsaved = 1;';

        try {
            writeFileSync(file, 'export const saved = 1;');
            stubNative();
            const before = nativeSpawn.mock.calls.length;

            runNative(cwd, () => 'stub', file, buffer, settings);
            runNative(cwd, () => 'stub', file, buffer, settings);
            expect(nativeSpawn.mock.calls.length).toBe(before + 1);

            touch(sheet);
            runNative(cwd, () => 'stub', file, buffer, settings);
            expect(nativeSpawn.mock.calls.length).toBe(before + 2);
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });
});

describe('require-function-class, through the real oxlint and the real binary', () => {
    beforeAll(() => {
        if (!existsSync(NATIVE_BINARY)) {
            throw new Error(
                `Native tests require the built binary: ${NATIVE_BINARY} (cargo build --release in native/)`,
            );
        }
    });

    const STYLES = [
        ':root { --palette-blue-600: #2563eb; --palette-white: #fff; }',
        '@theme {',
        '  --color-*: initial;',
        '  --color-accent-fill: var(--palette-blue-600);',
        '  --color-accent-on-fill: var(--palette-white);',
        '}',
        '@utility tone-accent-solid { @apply bg-accent-fill text-accent-on-fill; }',
        '@utility shape-control { @apply h-10 px-4; }',
        '@layer components {',
        '  .save-button { @apply shape-control tone-accent-solid; }',
        '}',
        '',
    ].join('\n');

    const APP = [
        'export const A = () => <div className="px-4" />;',
        'export const B = () => <button className="save-button">Save</button>;',
        '',
    ].join('\n');

    test('a Tailwind utility in markup is reported where it is; a Function is not', () => {
        const dir = mkdtempSync(path.join(os.tmpdir(), 'carburetor-classes-host-'));

        try {
            mkdirSync(path.join(dir, 'styles'));
            writeFileSync(path.join(dir, '.carburetorrc.json'), JSON.stringify({classes: {css: ['styles/*.css']}}));
            writeFileSync(path.join(dir, 'styles', 'app.css'), STYLES);
            writeFileSync(path.join(dir, 'App.tsx'), APP);
            writeFileSync(path.join(dir, 'oxlintrc.json'), JSON.stringify({
                jsPlugins: [path.join(ROOT, 'plugin', 'src', 'index.mts').replace(/\\/g, '/')],
                rules: {'carburetor/require-function-class': 'error'},
            }));

            const run = realSpawnSync(
                process.execPath,
                [path.join(ROOT, 'node_modules', 'oxlint', 'bin', 'oxlint'), '-f', 'unix', '-c', 'oxlintrc.json', 'App.tsx'],
                {cwd: dir, encoding: 'utf8', env: {...process.env, CARBURETOR_LINT_BIN: NATIVE_BINARY}},
            );
            const lines = (run.stdout || '').split('\n').filter((line) => line.includes('require-function-class'));

            expect(lines, `${run.stdout}\n${run.stderr}`).toHaveLength(1);
            expect(lines[0]).toContain('App.tsx:1:');
            expect(lines[0]).toContain('px-4 is a Tailwind utility');
        } finally {
            rmSync(dir, {recursive: true, force: true});
        }
    });
});

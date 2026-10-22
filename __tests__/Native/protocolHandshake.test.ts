import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {describe, expect, rstest, test} from "@rstest/core";
import {runNative} from "@plugin/Utils/Native/nativeBridge.mts";
import {RECOMMENDED} from "@plugin/recommended.mts";

type TNativeSpawn = typeof spawnSync;

const nativeSpawn = rstest.hoisted(() => rstest.fn<TNativeSpawn>());

rstest.mock('node:child_process', () => ({spawnSync: nativeSpawn}));

/** A diagnostics result in the bridge's own shape, as the freshness tests stage one. */
const diagnostics = (cwd: string): ReturnType<TNativeSpawn> => ({
    stdout: JSON.stringify([{
        rule: 'stub', file: './a.ts', line: 1, column: 1,
        message: readFileSync(path.join(cwd, 'a.ts'), 'utf8'), severity: 'error',
    }]),
    stderr: '', status: 0, error: undefined,
} as ReturnType<TNativeSpawn>);

/** Stubs the binary: `--version` gets the scenario's answer, a lint run gets diagnostics. */
const stubNative = (version: {stdout?: string; status: number; stderr?: string}, cwd: string): void => {
    nativeSpawn.mockImplementation((...args: Parameters<TNativeSpawn>) => {
        if ((args[1] as string[]).includes('--version')) {
            return {stdout: version.stdout ?? '', stderr: version.stderr ?? '', status: version.status,
                error: undefined} as ReturnType<TNativeSpawn>;
        }

        return diagnostics(cwd);
    });
};

/** How many spawns were `--version` checks, across every call so far. */
const versionSpawns = (): number =>
    nativeSpawn.mock.calls.filter((call) => (call[1] as string[]).includes('--version')).length;

describe('native protocol handshake', () => {
    test('a matching binary is checked once per path and then runs', () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-proto-'));
        const other = mkdtempSync(path.join(os.tmpdir(), 'carburetor-proto-'));

        try {
            stubNative({stdout: 'carburetor-lint 0.1.0 protocol 1', status: 0}, cwd);
            writeFileSync(path.join(cwd, 'a.ts'), 'first');

            expect(runNative(cwd, () => path.join('fake', 'bin-one'))[0].message).toBe('first');
            expect(runNative(cwd, () => path.join('fake', 'bin-one'))[0].message).toBe('first');
            // One `--version` per binary path, even across two runs: the cache is doing its job.
            expect(versionSpawns()).toBe(1);

            stubNative({stdout: 'carburetor-lint 0.1.0 protocol 1', status: 0}, other);
            writeFileSync(path.join(other, 'a.ts'), 'first');

            // A different resolver path is a different binary, so it is checked again.
            expect(runNative(other, () => path.join('fake', 'bin-two'))[0].message).toBe('first');
            expect(versionSpawns()).toBe(2);
        } finally {
            rmSync(cwd, {recursive: true, force: true});
            rmSync(other, {recursive: true, force: true});
        }
    });

    test('a binary speaking a newer protocol fails with the version line it printed', () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-proto-'));
        const binary = path.join('fake', 'bin-new');

        try {
            stubNative({stdout: 'carburetor-lint 0.1.0 protocol 2', status: 0}, cwd);

            let message = '';

            try {
                runNative(cwd, () => binary);
            } catch (error) {
                message = (error as Error).message;
            }

            expect(message).toContain(`the native binary at ${binary}`);
            expect(message).toContain('found: "carburetor-lint 0.1.0 protocol 2"');
            expect(message).toContain('needs protocol 1');
            expect(message).toContain('cargo build --release');
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test('a build without --version support fails with the older-build description', () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-proto-'));
        const binary = path.join('fake', 'bin-old');

        try {
            stubNative({status: 2, stderr: 'unknown option --version'}, cwd);

            expect(() => runNative(cwd, () => binary)).toThrow(/no --version support \(older build\)/);
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test('garbage on --version stdout fails with that garbage quoted', () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-proto-'));
        const binary = path.join('fake', 'bin-weird');

        try {
            stubNative({stdout: 'hello world', status: 0}, cwd);

            expect(() => runNative(cwd, () => binary)).toThrow('found: "hello world"');
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });
});

/** The fingerprint of the bridge/binary contract the handshake exists to guard. */
const EXPECTED_FINGERPRINT = '82d5e9e7fb79c90894716689376ddee6';

/** The quoted CLI flag tokens `parse_options` in native/src/main.rs understands. */
const cliFlags = (main: string): string[] => [
    ...main.matchAll(/"--[a-z-]+"/g), ...main.matchAll(/"-[A-Za-z]"/g),
].map((match) => match[0]);

/** The quoted config keys named on native's `unknown key` diagnostic line. */
const configKeys = (config: string): string[] => {
    const line = config.split('\n').find((text) => text.includes('unknown key') && text.includes('expected')) ?? '';

    return [...line.replace(/\\/g, '').matchAll(/"([^"]+)"/g)].map((match) => `"${match[1]}"`);
};

describe('bridge/binary contract guards', () => {
    test('the protocol constants agree', () => {
        const root = process.cwd();
        const native = readFileSync(path.join(root, 'native', 'src', 'main.rs'), 'utf8').replace(/\r\n/g, '\n');
        const plugin =
            readFileSync(path.join(root, 'plugin', 'src', 'Utils', 'assertProtocol.mts'), 'utf8')
                .replace(/\r\n/g, '\n');
        const protocol = /\bconst PROTOCOL: u32 = (\d+)/.exec(native)?.[1];
        const expected = /NATIVE_PROTOCOL = (\d+)/.exec(plugin)?.[1];

        expect(
            protocol,
            'bump PROTOCOL in native/src/main.rs and NATIVE_PROTOCOL in ' +
            'plugin/src/Utils/assertProtocol.mts together',
        ).toBe('1');
        expect(
            expected,
            'bump NATIVE_PROTOCOL in plugin/src/Utils/assertProtocol.mts and PROTOCOL in ' +
            'native/src/main.rs together',
        ).toBe(protocol);
    });

    test('the fingerprint of the contract has not drifted', () => {
        const root = process.cwd();
        const main = readFileSync(path.join(root, 'native', 'src', 'main.rs'), 'utf8').replace(/\r\n/g, '\n');
        const config = readFileSync(path.join(root, 'native', 'src', 'config', 'mod.rs'), 'utf8')
            .replace(/\r\n/g, '\n');
        const rules = Object.keys(RECOMMENDED).map((id) => `"${id}"`);
        const tokens = [...new Set([...cliFlags(main), ...configKeys(config), ...rules])].sort().join('');
        const fingerprint = createHash('sha256').update(tokens).digest('hex').slice(0, 32);

        expect(
            fingerprint,
            'the bridge/binary contract changed: bump PROTOCOL in native/src/main.rs and ' +
            'NATIVE_PROTOCOL in plugin/src/Utils/assertProtocol.mts, then update the fingerprint',
        ).toBe(EXPECTED_FINGERPRINT);
    });
});

import {spawnSync} from "node:child_process";
import {closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {RECOMMENDED} from "#src/recommended.mts";
import {resolveBinary} from "#src/Utils/Native/resolveBinary.mts";
import type {INativeDiagnostic} from "#src/Utils/Native/INativeDiagnostic.mts";

/**
 * Runs the native binary once per lint run and hands every rule its own slice of the result.
 *
 * "Once" is the whole point: these 22 checks used to be a JavaScript plugin, measured at 270 ms
 * over this repository against 20 ms for the same work natively (see native/README.md). Losing
 * that gain to running the binary once per rule per file — 22 times over, once per file — would
 * spend the saving faster than it was made. So the first rule any host asks to run triggers one
 * process over the whole project; every rule after that, in every file, reads from the same result.
 *
 * Module-scope state does this for free within one process: the plugin module loads once and
 * `create()` runs once per rule per file, but the state above `create()` survives across all of
 * them. ESLint's `--concurrency` mode is the exception — several worker threads, each its own JS
 * engine with its own module state, sharing only `process.pid` — so the cross-thread half of this
 * uses the filesystem: the first worker to create a lock file becomes the runner and the rest wait
 * for the result file it writes, using `Atomics.wait` as a blocking sleep rather than a spin loop,
 * since a rule's visitor cannot be asynchronous.
 */

/** Every rule id native knows, whatever this project's own config says about severity. */
const ALL_RULE_IDS: readonly string[] = Object.keys(RECOMMENDED);

/** How long a worker waits for another one's run before giving up and reporting nothing. */
const WAIT_TIMEOUT_MS = 30_000;

/** How long each `Atomics.wait` sleeps before checking again for the result file. */
const POLL_INTERVAL_MS = 20;

let cached: INativeDiagnostic[] | undefined;

/** Sleeps synchronously; a rule's visitor has no `await` to reach for. */
const sleepSync = (milliseconds: number): void => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

/** Where this run's lock and result live, namespaced by pid and cwd so two runs cannot collide. */
const runPaths = (cwd: string): {lock: string; result: string} => {
    const digest = Buffer.from(cwd).toString('base64url').slice(0, 24);
    const base = path.join(os.tmpdir(), `carburetor-lint-${process.pid}-${digest}`);

    return {lock: `${base}.lock`, result: `${base}.json`};
};

/** Runs the binary over `cwd`, forcing every rule on so a project's own config cannot turn one
 * off from underneath native and lose diagnostics the host still wants reported. The host, not
 * native, decides what actually surfaces: a rule this call finds is only ever reported through the
 * rule of that same id, and the host never calls that rule's `create()` unless it is enabled. */
const runBinary = (cwd: string): INativeDiagnostic[] => {
    const binary = resolveBinary();

    if (!binary) {
        throw new Error(
            'react-carburetor/lint: the native binary was not found. Run "cargo build --release" ' +
            'inside native/, or set CARBURETOR_LINT_BIN to a built binary.'
        );
    }

    const args = ALL_RULE_IDS.flatMap((id) => ['--rule', `${id}=error`]);
    const result = spawnSync(binary, ['--format=json', ...args, '.'], {cwd, encoding: 'utf8'});

    // `spawnSync` never throws; a launch failure (missing file, not executable, bad path) shows up
    // here instead, with `status: null` — checking only `status === 2` would silently swallow it
    // and every rule would report nothing, which is worse than a loud, immediate failure.
    if (result.error) {
        throw new Error(`react-carburetor/lint: could not run the native binary at ${binary}: ${result.error.message}`);
    }

    if (result.status === 2) {
        throw new Error(`react-carburetor/lint: the native binary failed: ${result.stderr}`);
    }

    return JSON.parse(result.stdout || '[]') as INativeDiagnostic[];
};

/** Runs the native binary once for this process, sharing the result across worker threads. */
export const runNativeOnce = (cwd: string): INativeDiagnostic[] => {
    if (cached) {
        return cached;
    }

    const {lock, result} = runPaths(cwd);

    mkdirSync(path.dirname(lock), {recursive: true});

    let isRunner = false;

    try {
        closeSync(openSync(lock, 'wx'));
        isRunner = true;
    } catch {
        isRunner = false;
    }

    if (isRunner) {
        try {
            cached = runBinary(cwd);
            writeFileSync(result, JSON.stringify(cached));

            return cached;
        } finally {
            try {
                unlinkSync(lock);
            } catch {
                // Another process may have already cleared it; nothing to do either way.
            }
        }
    }

    const deadline = Date.now() + WAIT_TIMEOUT_MS;

    while (!existsSync(result) && Date.now() < deadline) {
        sleepSync(POLL_INTERVAL_MS);
    }

    cached = existsSync(result) ? (JSON.parse(readFileSync(result, 'utf8')) as INativeDiagnostic[]) : [];

    return cached;
};

import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {
    closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, unlinkSync,
} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {RECOMMENDED} from "#src/recommended.mts";
import {platformPackageNames} from "#src/Utils/Native/platformPackage.mts";
import {resolveBinary} from "#src/Utils/Native/resolveBinary.mts";
import type {INativeDiagnostic} from "#src/Utils/Native/INativeDiagnostic.mts";
import {cachedFileResult} from "#src/Utils/bufferCache.mts";
import {writeAtomic} from "#src/Utils/atomicWrite.mts";
import {assertProtocol} from "#src/Utils/assertProtocol.mts";
import {basesConfig} from "#src/Utils/NativeBases.mts";

/**
 * Runs the native binary once per lint run and hands every rule its own slice of the result.
 *
 * "Once" matters for speed (20 ms native vs. 270 ms in JS per native/README.md), so the first rule
 * any host asks to run triggers one process for the whole project; module-scope `cached` makes that
 * free within one JS thread. ESLint's `--concurrency` mode is the exception — worker threads share
 * `process.pid` but not module state — so the cross-thread half uses the filesystem: a lock file
 * elects one runner, the rest poll for the result it writes. oxlint itself calls JS plugins from a
 * single thread (verified against its bundle), so this dance is inert there; it exists for hosts
 * that do run several threads in one process.
 *
 * The result path is named after the lock file's own `dev`/`ino`, not just pid and cwd, so a
 * leftover file from a dead process with a reused pid can never collide with this run's file.
 * Writes are published via temp-name-then-`renameSync` so a reader never sees a half written file.
 * Lock and result files live in their own temp subdirectory and are deleted at process exit, once
 * no later-arriving thread could still need them.
 *
 * The binary runs with the configuration resolved from the host's settings (see
 * `basesConfig`): `componentBases`/`storeBases` act here exactly as on the CLI, and
 * `settings.carburetor.ruleOptions` land in that config as per-rule `["error", {…}]` entries —
 * the `--rule` flags below fix the severity, the options are what reach the rules.
 */

/** Every rule id native knows, whatever this project's own config says about severity. */
const ALL_RULE_IDS: readonly string[] = Object.keys(RECOMMENDED);

/** How long a worker waits for another one's run before giving up and reporting nothing. */
const WAIT_TIMEOUT_MS = 30_000;

/** How long each `Atomics.wait` sleeps before checking again for the result file. */
const POLL_INTERVAL_MS = 20;

/** All lock/result files live here, not loose in the temp root, so a scan of them stays cheap. */
const BRIDGE_DIR = path.join(os.tmpdir(), 'carburetor-lint');

/** This process's own start time; a lock older than this cannot belong to a thread of this run. */
const PROCESS_START_MS = Date.now() - Math.round(process.uptime() * 1000);

/** mtime granularity slack, so a lock created moments before this process is not misjudged foreign. */
const STALE_LOCK_TOLERANCE_MS = 2_000;

/** Bounds the claim retry loop against a lock that keeps vanishing mid-check. */
const MAX_CLAIM_ATTEMPTS = 5;

let cached: INativeDiagnostic[] | undefined;

/** The project, start time and base key of the run `cached` came from; two hosts settings with
 * different base lists in one process must not share a result, and a file saved after the run
 * it came from is not covered either. */
let cachedCwd: string | undefined;
let cachedKey = '';
let cachedStartMs = 0;

/** This run's own lock/result files, deleted together once nothing can read them anymore. */
const pendingCleanup = new Set<string>();
let cleanupRegistered = false;

/** Sleeps synchronously; a rule's visitor has no `await` to reach for. */
const sleepSync = (milliseconds: number): void => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

/** The lock path and cwd/base digest; the digest also scopes the leftover-file sweep. An empty
 * key keeps the original bare-cwd digest, so locks from before base keys existed still match. */
const runPaths = (cwd: string, key: string): {lock: string; digest: string} => {
    const digest = createHash('sha256').update(key === '' ? cwd : `${cwd}\u0000${key}`).digest('hex').slice(0, 32);

    return {lock: path.join(BRIDGE_DIR, `${process.pid}-${digest}.lock`), digest};
};

/** The result path for a given lock instance: the lock's own filesystem identity, immune to a
 * leftover lock from a dead process with a reused pid ever pointing at the same file. */
const resultPathFor = (lock: string, identity: {dev: number; ino: number}): string =>
    lock.replace(/\.lock$/, `.${identity.dev.toString(36)}${identity.ino.toString(36)}.json`);

/** True if `pid` names a live process; `EPERM` still means it exists, just owned by someone else. */
const isAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);

        return true;
    } catch (error) {
        return (error as {code?: string}).code === 'EPERM';
    }
};

/** Deletes this cwd's leftover lock/result files from pids no longer running; never a live one's. */
const sweepStaleFiles = (digest: string): void => {
    let entries: string[];

    try {
        entries = readdirSync(BRIDGE_DIR);
    } catch {
        return;
    }

    const pattern = new RegExp(`^(\\d+)-${digest}(?:\\.[0-9a-z]+)?\\.(?:lock|json)$`);

    for (const name of entries) {
        const match = pattern.exec(name);
        const pid = match === null ? undefined : Number(match[1]);

        if (pid === undefined || pid === process.pid || isAlive(pid)) {
            continue;
        }

        try {
            unlinkSync(path.join(BRIDGE_DIR, name));
        } catch {
            // Another process's own sweep may have already cleared it; nothing to do either way.
        }
    }
};

/** Unlinks this run's own files once nothing running could still need them, at process exit. */
const scheduleCleanup = (...paths: string[]): void => {
    paths.forEach((file) => pendingCleanup.add(file));

    if (cleanupRegistered) {
        return;
    }

    cleanupRegistered = true;
    process.once('exit', () => {
        for (const file of pendingCleanup) {
            try {
                unlinkSync(file);
            } catch {
                // Never written, or already gone; nothing to do either way.
            }
        }
    });
};

/** True if `lock` predates this process's own start, meaning it cannot belong to any thread of it. */
const isForeignAndDead = (lock: string): boolean => {
    try {
        return statSync(lock).mtimeMs < PROCESS_START_MS - STALE_LOCK_TOLERANCE_MS;
    } catch {
        return false;
    }
};

/** Elects this thread the runner by creating `lock`, reclaiming it first only if it predates this
 * process (so it cannot be a live sibling thread's). Retries if the lock vanishes mid-check. */
const claimLock = (lock: string): {isRunner: boolean; identity: {dev: number; ino: number}} => {
    for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
        try {
            closeSync(openSync(lock, 'wx'));

            return {isRunner: true, identity: statSync(lock)};
        } catch {
            // Someone else holds it, or it just vanished; both are sorted out below.
        }

        if (isForeignAndDead(lock)) {
            try {
                unlinkSync(lock);
            } catch {
                // A sibling thread may already be reclaiming it; the retry above settles it either way.
            }

            continue;
        }

        try {
            return {isRunner: false, identity: statSync(lock)};
        } catch {
            // The lock vanished between our failed create and this stat; retry from the top.
        }
    }

    throw new Error('react-carburetor/lint: could not claim or read the native bridge lock.');
};

/** Runs the binary over `cwd` with every rule forced on, so the host — not native — decides what
 * a rule's own `create()` actually surfaces. `config` is the file `basesConfig` generated from
 * the host's settings, carrying the base-class lists and any per-rule options, so both act here
 * as on the CLI. `--keep-overlaps`
 * disables native's own deduplication of overlapping rules — a host may have disabled the rule a
 * diagnostic would otherwise be folded into; those overlaps are re-deduplicated host-side in
 * nativeRule.mts.
 *
 * @param cwd - the project the binary runs in
 * @param config - the config file the binary is started with (bases and rule options)
 * @param resolve - where the binary is; injectable so a test can stage one
 */
const runBinary = (
    cwd: string,
    config: string,
    resolve: () => string | undefined = resolveBinary,
): INativeDiagnostic[] => {
    const binary = resolve();

    if (!binary) {
        throw new Error(
            'react-carburetor/lint: no native binary for this platform. Install it with ' +
            '"npm install --save-dev carburetor-lint" (its optionalDependencies add the package ' +
            `this machine needs, ${platformPackageNames()[0]}), or set CARBURETOR_LINT_BIN to a ` +
            'built binary, or run "cargo build --release" inside native/ in a checkout of this ' +
            'repository.'
        );
    }

    assertProtocol(binary);

    const args = ALL_RULE_IDS.flatMap((id) => ['--rule', `${id}=error`]);
    const result = spawnSync(
        binary,
        ['--config', config, '--format=json', '--keep-overlaps', ...args, '.'],
        // The JSON for a whole-project run is far bigger than 's 1 MiB default
        // buffer once the allocation rules scan every nested function, so the cap is raised
        // rather than left to fail as an ENOBUFS launch error.
        {cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024},
    );

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

/** Runs the binary over one buffer, as if it were `filename`: the one way a host can have an
 * unsaved buffer analyzed. The flags mirror `runBinary` exactly — every rule on, overlaps kept,
 * the same base-class config — so a file's in-memory findings are the same set its saved file
 * would earn.
 *
 * @param cwd - the project the binary runs in; the file's path is reported relative to it
 * @param filename - the absolute path the buffer is analyzed as
 * @param text - the buffer's own text, piped to the binary's standard input
 * @param config - the config file the binary is started with (bases and rule options)
 * @param resolve - where the binary is; injectable so a test can stage one
 */
const runNativeText = (
    cwd: string,
    filename: string,
    text: string,
    config: string,
    resolve: () => string | undefined = resolveBinary,
): INativeDiagnostic[] => {
    const binary = resolve();

    if (!binary) {
        throw new Error(
            'react-carburetor/lint: no native binary for this platform. Install it with ' +
            '"npm install --save-dev carburetor-lint" (its optionalDependencies add the package ' +
            `this machine needs, ${platformPackageNames()[0]}), or set CARBURETOR_LINT_BIN to a ` +
            'built binary, or run "cargo build --release" inside native/ in a checkout of this ' +
            'repository.'
        );
    }

    assertProtocol(binary);

    const args = ALL_RULE_IDS.flatMap((id) => ['--rule', `${id}=error`]);
    const relative = path.relative(cwd, filename).replace(/\\/g, '/');
    const result = spawnSync(
        binary,
        ['--config', config, '--format=json', '--keep-overlaps', ...args, '--stdin', relative],
        {cwd, encoding: 'utf8', input: text, maxBuffer: 64 * 1024 * 1024},
    );

    if (result.error) {
        throw new Error(`react-carburetor/lint: could not run the native binary at ${binary}: ${result.error.message}`);
    }

    if (result.status === 2) {
        throw new Error(`react-carburetor/lint: the native binary failed: ${result.stderr}`);
    }

    return JSON.parse(result.stdout || '[]') as INativeDiagnostic[];
};


/** Filesystem timestamps are coarse (a kernel tick, or seconds on some volumes) and can trail
 * `Date.now()`, so a save moments after a run began may carry an mtime just before its start. */
const MTIME_SLACK_MS = 2_000;

/** True if `filename` may have been saved after `startMs`, so a run begun then may not describe it. */
const changedSince = (filename: string | undefined, startMs: number): boolean => {
    if (!filename) {
        return false;
    }

    try {
        return statSync(filename).mtimeMs >= startMs - MTIME_SLACK_MS;
    } catch {
        return false;
    }
};

/** The file's saved content, or `undefined` when it has none: a buffer with no file behind it
 * (or an unreadable one) is always treated as differing, so it takes the in-memory path. */
const diskText = (filename: string): string | undefined => {
    try {
        return readFileSync(filename, 'utf8');
    } catch {
        return undefined;
    }
};
/** Runs the native binary once for this process, sharing the result across worker threads.
 * The resolver is injectable so a test can stage an install with no binary.
 *
 * Native reads saved files from disk, so a long-lived host (an editor, a watch run) would keep
 * the first answer forever. A file saved after the cached run began is therefore re-linted: the
 * project is scanned again in this thread alone, with no cross-thread sharing, which is rare
 * and keeps the lock protocol untouched. A buffer whose text differs from its file on disk is
 * linted on its own through the binary's `--stdin` mode (see `runNativeText`), so an editor's
 * squiggles describe what is in the editor, not what was last saved.
 *
 * @param cwd - the project the binary lints; its digest also names this run's lock file
 * @param resolve - consulted only by the worker that wins the lock; waiters never resolve
 * @param filename - the file being linted; a save after the cached run forces a fresh scan
 * @param text - the host's own buffer content, when it may differ from the file on disk
 * @param settings - the host's settings object; its `carburetor` namespace carries the base
 * lists and per-rule options that reach the binary (see `basesConfig`), and keys this run's
 * caches
 */
export const runNative = (
    cwd: string,
    resolve: () => string | undefined = resolveBinary,
    filename?: string,
    text?: string,
    settings?: Record<string, unknown>,
): INativeDiagnostic[] => {
    const {config, key} = basesConfig(cwd, settings);

    // One re-scan path for both cache hits: a new start time is adopted only after the scan
    // succeeded, so a failed one cannot make stale results look fresh.
    const rescan = (): INativeDiagnostic[] => {
        const startMs = Date.now();
        const fresh = runBinary(cwd, config, resolve);

        cachedStartMs = startMs;
        cached = fresh;

        return fresh;
    };

    if (text !== undefined && filename !== undefined && text !== diskText(filename)) {
        // One spawn per distinct buffer text, not per rule and not per keystroke.
        return cachedFileResult(filename, text, () => runNativeText(cwd, filename, text, config, resolve), key);
    }

    if (cached && cachedCwd === cwd && cachedKey === key) {
        if (!changedSince(filename, cachedStartMs)) {
            return cached;
        }

        return rescan();
    }

    const {lock, digest} = runPaths(cwd, key);

    mkdirSync(BRIDGE_DIR, {recursive: true});

    const {isRunner, identity} = claimLock(lock);
    const result = resultPathFor(lock, identity);

    scheduleCleanup(lock, result);

    if (isRunner) {
        sweepStaleFiles(digest);

        try {
            const startMs = Date.now();
            const fresh = runBinary(cwd, config, resolve);

            // Published only after success: a failed run must leave no cache entry behind, or the
            // next call with the same key would be served another set's array instead of retrying.
            cachedStartMs = startMs;
            cachedCwd = cwd;
            cachedKey = key;
            cached = fresh;
            writeAtomic(result, JSON.stringify(cached));

            return cached;
        } catch (error) {
            // The waiters would otherwise spend their whole timeout waiting for a result that
            // will never come and then report nothing; hand them this failure so every worker
            // fails the same loud way the runner did.
            writeAtomic(result, JSON.stringify({error: error instanceof Error ? error.message : String(error)}));

            throw error;
        }
    }

    const deadline = Date.now() + WAIT_TIMEOUT_MS;

    while (!existsSync(result) && Date.now() < deadline) {
        sleepSync(POLL_INTERVAL_MS);
    }

    if (!existsSync(result)) {
        throw new Error(
            'react-carburetor/lint: another worker ran the native binary but produced no ' +
            `result within ${WAIT_TIMEOUT_MS} ms. Run the binary directly to see why.`
        );
    }

    // A runner that failed writes its error instead of a diagnostics array, so a worker
    // reading the file either reports the run or reports the failure — never a clean zero.
    const payload = JSON.parse(readFileSync(result, 'utf8')) as INativeDiagnostic[] | {error: string};

    if (!Array.isArray(payload)) {
        throw new Error(`react-carburetor/lint: the worker that ran the native binary failed: ${payload.error}`);
    }

    cached = payload;
    cachedCwd = cwd;
    cachedKey = key;
    cachedStartMs = statSync(lock).mtimeMs;

    // A file result may describe a file as it stood before that file was last saved, so the same
    // freshness check the module cache applies decides between this answer and a re-scan.
    if (changedSince(filename, cachedStartMs)) {
        return rescan();
    }

    return cached;
};

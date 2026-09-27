import {spawnSync} from "node:child_process";
import {
    closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync,
    writeFileSync,
} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {RECOMMENDED} from "#src/recommended.mts";
import {platformPackageNames} from "#src/Utils/Native/platformPackage.mts";
import {resolveBinary} from "#src/Utils/Native/resolveBinary.mts";
import type {INativeDiagnostic} from "#src/Utils/Native/INativeDiagnostic.mts";

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

/** This run's own lock/result files, deleted together once nothing can read them anymore. */
const pendingCleanup = new Set<string>();
let cleanupRegistered = false;

/** Sleeps synchronously; a rule's visitor has no `await` to reach for. */
const sleepSync = (milliseconds: number): void => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

/** This run's lock path and cwd digest; the digest also scopes the leftover-file sweep. */
const runPaths = (cwd: string): {lock: string; digest: string} => {
    const digest = Buffer.from(cwd).toString('base64url').slice(0, 24);

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

/** Writes `content` so a reader only ever sees it complete: a temp name, then one atomic rename. */
const writeAtomic = (target: string, content: string): void => {
    const tmp = `${target}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`;

    writeFileSync(tmp, content);

    try {
        renameSync(tmp, target);
    } catch (error) {
        try {
            unlinkSync(tmp);
        } catch {
            // Best-effort; the rename failure below is the one that matters.
        }

        throw error;
    }
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
 * a rule's own `create()` actually surfaces. */
const runBinary = (cwd: string, resolve: () => string | undefined = resolveBinary): INativeDiagnostic[] => {
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

/** Runs the native binary once for this process, sharing the result across worker threads.
 * The resolver is injectable so a test can stage an install with no binary.
 *
 * @param cwd - the project the binary lints; its digest also names this run's lock file
 * @param resolve - consulted only by the worker that wins the lock; waiters never resolve
 */
export const runNativeOnce = (cwd: string, resolve: () => string | undefined = resolveBinary): INativeDiagnostic[] => {
    if (cached) {
        return cached;
    }

    const {lock, digest} = runPaths(cwd);

    mkdirSync(BRIDGE_DIR, {recursive: true});

    const {isRunner, identity} = claimLock(lock);
    const result = resultPathFor(lock, identity);

    scheduleCleanup(lock, result);

    if (isRunner) {
        sweepStaleFiles(digest);

        try {
            cached = runBinary(cwd, resolve);
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

    return cached;
};

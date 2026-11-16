import type {ISpawnResult} from "node:child_process";
import type {INativeDiagnostic} from "#src/Utils/Native/INativeDiagnostic.mts";

/**
 * Why a fork is refused with memory to spare, and the two ways out. On Linux the kernel's default
 * heuristic overcommit judges a fork by the parent's reserved address space; `oxlint --type-aware`
 * reserves a lot of it up front, so starting even a small child from inside it can fail.
 */
const FORK_REFUSED =
    '. The system refused to start a process from this one: on Linux, a host that reserves a lot of ' +
    'address space (oxlint --type-aware) is refused a fork under the default overcommit heuristic, even ' +
    'with memory free. Run "sudo sysctl -w vm.overcommit_memory=1" before linting (in CI, as a step ' +
    'before the lint step), or run the rules outside the host with "npx carburetor-lint".';

/**
 * Turns a finished run of the native binary into its diagnostics, or a loud failure.
 *
 * The binary exits 0 (nothing found) or 1 (findings) after printing its JSON. Anything else is a
 * run that did not finish: exit 2 is its own "the linter failed", and a crash shows up as a
 * foreign status or as `null` with a signal — the release profile aborts on panic. Reading an
 * unfinished run's empty output as "no problems" would be a silent clean result.
 *
 * @param binary - the path that was run, named in the failure
 * @param result - what `spawnSync` returned for it
 */
export const nativeOutput = (binary: string, result: ISpawnResult): INativeDiagnostic[] => {
    // `spawnSync` never throws; a launch failure (missing file, not executable, bad path) shows up
    // here instead, with `status: null`.
    if (result.error) {
        const refused = result.error.code === 'ENOMEM' || result.error.message.includes('ENOMEM');

        throw new Error(
            `@react-carburetor/core/lint: could not run the native binary at ${binary}: ${result.error.message}` +
            (refused ? FORK_REFUSED : ''),
        );
    }

    if (result.status !== 0 && result.status !== 1) {
        const how = result.status === null
            ? `terminated by ${result.signal ?? 'an unknown signal'}`
            : `exit code ${result.status}`;

        throw new Error(`@react-carburetor/core/lint: the native binary failed (${how}): ${result.stderr}`);
    }

    return JSON.parse(result.stdout || '[]') as INativeDiagnostic[];
};

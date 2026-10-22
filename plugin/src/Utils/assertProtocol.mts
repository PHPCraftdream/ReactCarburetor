import {spawnSync} from "node:child_process";

/**
 * Bump this together with `PROTOCOL` in `native/src/main.rs` whenever the bridge/binary
 * contract changes (CLI flags, config keys, rule ids).
 */
const NATIVE_PROTOCOL = 1;

/** `--version` already passed for these resolved binary paths; one check per path per process. */
const checked = new Map<string, true>();

/** True when stdout is exactly the expected four-field version line for this protocol. */
const isCompatible = (stdout: string): boolean => {
    const fields = stdout.trim().split(/\s+/);

    return fields.length === 4 &&
        fields[0] === 'carburetor-lint' &&
        fields[2] === 'protocol' &&
        fields[3] === String(NATIVE_PROTOCOL);
};

/**
 * Checks once per resolved binary path that it speaks this plugin's protocol, via `--version`.
 * Throws one loud error naming the binary and the remedy; a silent old binary would otherwise
 * report nothing (or fail on unknown flags) instead of explaining itself.
 *
 * @param binary - the resolved path of the native binary about to be spawned
 */
export const assertProtocol = (binary: string): void => {
    if (checked.has(binary)) {
        return;
    }

    const result = spawnSync(binary, ['--version'], {encoding: 'utf8'});
    // An old build rejects the unknown flag with exit 2; a launch failure looks the same to us.
    const missing = Boolean(result.error) || result.status !== 0;
    const firstLine = (result.stdout || '').trim().split('\n')[0];
    const found = missing
        ? 'no --version support (older build)'
        : `"${firstLine || 'no --version support (older build)'}"`;

    if (missing || !isCompatible(result.stdout || '')) {
        throw new Error(
            `react-carburetor/lint: the native binary at ${binary} is from a different version ` +
            `(found: ${found}; this plugin needs protocol ${NATIVE_PROTOCOL}): rebuild it with ` +
            '"cargo build --release" inside native/, or install a matching carburetor-lint.'
        );
    }

    checked.set(binary, true);
};

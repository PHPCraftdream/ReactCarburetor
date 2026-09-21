/**
 * The npm packages that carry a prebuilt binary, in the order to try them.
 *
 * The `carburetor-lint` command package lists every platform package under
 * `optionalDependencies`, and npm installs only the one whose `os`/`cpu`/`libc` fields match
 * the installing machine. Naming follows oxlint: `carburetor-lint-<platform>[-<libc>]`,
 * unscoped like this repository's own `react-carburetor`. glibc and musl builds are not
 * interchangeable, so on linux both are candidates, ordered by detection: `process.report`
 * names the running libc when reports are enabled, and glibc wins the default when they are
 * not, because that is where most Linux installs are. The launcher script in
 * `npm/carburetor-lint/bin/` duplicates this logic because it cannot import the plugin's
 * sources — keep the two in step when a target is added.
 */
export const platformPackageNames = (
    platform: string = process.platform,
    arch: string = process.arch,
): readonly string[] => {
    if (platform === 'linux') {
        const order = reportLibc() === 'musl' ? ['musl', 'gnu'] : ['gnu', 'musl'];

        return order.map((libc) => `carburetor-lint-linux-${arch}-${libc}`);
    }

    return [`carburetor-lint-${platform}-${arch}`];
};

/** Reads the running libc off Node's own report; `undefined` when reports are switched off. */
const reportLibc = (): 'gnu' | 'musl' | undefined => {
    try {
        const header = process.report?.getReport().header;

        return header?.glibcVersionRuntime ? 'gnu' : header ? 'musl' : undefined;
    } catch {
        return undefined;
    }
};

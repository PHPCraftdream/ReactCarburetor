#!/usr/bin/env node
'use strict';

// Thin launcher: `npm i -D carburetor-lint` installs exactly one platform package through
// optionalDependencies — npm's `os`/`cpu`/`libc` fields gate the rest — and this script finds
// that package's binary and hands it the arguments, stdio and exit code it was given.
// The same platform logic lives in plugin/src/Utils/Native/platformPackage.mts for the lint
// bridge; the two exist separately because this package cannot import the plugin's sources.
// Keep them in step when a target is added.

const {spawnSync} = require('child_process');
const {existsSync} = require('fs');
const path = require('path');

// The compiled binary's file name inside every platform package; also what the bridge resolves.
const BINARY_NAME = process.platform === 'win32' ? 'carburetor-lint.exe' : 'carburetor-lint';

// glibc and musl builds are not interchangeable. `process.report` names the running libc when
// reports are enabled; when it is not, glibc is the better guess — the other package is still
// tried, so an unusual machine pays one failed resolution, not a failure. npm's `libc` field
// does this same selection at install time on newer npm; this covers installers old enough to
// have downloaded both.
const linuxCandidates = () => {
    let preferred = 'gnu';

    try {
        const report = process.report && process.report.getReport();

        if (report && report.header && !report.header.glibcVersionRuntime) {
            preferred = 'musl';
        }
    } catch {
        // Detection is best-effort; the fallback order below still resolves one of the two.
    }

    return preferred === 'gnu' ? ['gnu', 'musl'] : ['musl', 'gnu'];
};

const packageNames = () => {
    if (process.platform === 'linux') {
        return linuxCandidates().map((libc) => `carburetor-lint-linux-${process.arch}-${libc}`);
    }

    return [`carburetor-lint-${process.platform}-${process.arch}`];
};

const findBinary = () => {
    // Matches the bridge's own CARBURETOR_LINT_BIN override (plugin/src/Utils/Native/
    // resolveBinary.mts): an explicit human decision wins when it points at a real file; a
    // stale or empty value falls through to the platform lookup rather than failing outright.
    const override = process.env.CARBURETOR_LINT_BIN;

    if (override && existsSync(override)) {
        return override;
    }

    for (const name of packageNames()) {
        try {
            // The platform packages publish no `exports` map on purpose, so the launcher can
            // resolve through to the binary by path.
            const directory = path.dirname(require.resolve(`${name}/package.json`));
            const binary = path.join(directory, BINARY_NAME);

            // The existsSync re-check matters when a development checkout links the packages
            // into node_modules without the binary inside: fall through to the loud error
            // below rather than a confusing spawn failure.
            if (existsSync(binary)) {
                return binary;
            }
        } catch {
            // npm skips every package whose os/cpu/libc does not match; on this machine that
            // is every candidate but (at most) one.
        }
    }

    return undefined;
};

const binary = findBinary();

if (!binary) {
    process.stderr.write(
        `carburetor-lint: no binary for ${process.platform}-${process.arch} ` +
        `(expected package ${packageNames()[0]}).\n` +
        'The platform packages are optionalDependencies of this package: an install run with ' +
        '--omit=optional or --no-optional skips them. Reinstall without it, or set ' +
        'CARBURETOR_LINT_BIN to a built binary.\n'
    );

    // The binary's own exit code for "the linter itself failed" — a broken install is that,
    // not "problems found".
    process.exit(2);
}

const result = spawnSync(binary, process.argv.slice(2), {stdio: 'inherit'});

if (result.error) {
    process.stderr.write(`carburetor-lint: could not run ${binary}: ${result.error.message}\n`);

    process.exit(1);
}

// `status` is null only when a signal killed the child; there is no code to pass through then.
process.exit(result.status === null ? 1 : result.status);

import {existsSync} from "node:fs";
import {createRequire} from "node:module";
import * as path from "node:path";
import {fileURLToPath} from "node:url";
import {platformPackageNames} from "#src/Utils/Native/platformPackage.mts";

/** The binary's file name on this platform. */
const BINARY_NAME: string = process.platform === 'win32' ? 'carburetor-lint.exe' : 'carburetor-lint';

/** This file's own directory, used to find the workspace `native/` crate during development. */
const HERE: string = path.dirname(fileURLToPath(import.meta.url));

/** An ESM module has no `require`; resolving an optional package still needs its algorithm. */
const requireFrom = createRequire(import.meta.url);

/**
 * Locates the native binary, in the order a consumer's install is most likely to provide it.
 *
 * 1. `CARBURETOR_LINT_BIN` — an explicit override, for tests and for a consumer whose platform
 *    has no prebuilt binary but who built one themselves.
 * 2. The `@react-carburetor/lint` launcher package resolved from the project working directory — the
 *    launcher is what a consumer actually installs (`pnpm add -D @react-carburetor/lint`), and its
 *    `optionalDependencies` carry the platform packages; in an isolated layout (pnpm) they sit
 *    under the launcher's own `node_modules`, invisible from this file's position, so the lookup
 *    must be anchored at the project.
 * 3. The platform package a published install provides — `@react-carburetor/lint-<platform>`, found
 *    through `require`'s normal `node_modules` walk from this file. A layout where the platform
 *    package is hoisted next to this plugin still hits here.
 * 4. `native/target/release`, then `native/target/debug`, found by walking upward from this
 *    file — what a contributor has after `cargo build`, so linting this repository itself
 *    needs no packaging. The walk exists because this file's own distance from the repo root
 *    is not fixed: it is four directories down as a source file (`plugin/src/Utils/Native/`)
 *    but one down once bundled (`dist/lint/`), and a fixed number of `..` segments is right
 *    for only one of them.
 *
 * The order is the order of intent: an environment variable is a human decision, the launcher is
 * npm's as the project installed it, a platform package is npm's as this repository was installed,
 * and the walk is this repository's own development path. Returns `undefined`
 * rather than throwing: a project that enables no carburetor rule should never need the binary
 * at all, so the failure belongs to the first rule that actually asks — and that failure is
 * loud (see nativeBridge.mts), never an empty result.
 */
export const resolveBinary = (): string | undefined => {
    const override = process.env.CARBURETOR_LINT_BIN;

    if (override && existsSync(override)) {
        return override;
    }

    const launcherPackage = launcherPackageBinary();

    if (launcherPackage) {
        return launcherPackage;
    }

    const platformPackage = platformPackageBinary();

    if (platformPackage) {
        return platformPackage;
    }

    return workspaceBinary();
};

/** Walks upward from this file looking for a workspace `native/target/{release,debug}` build. */
const workspaceBinary = (): string | undefined => {
    let directory = HERE;

    for (;;) {
        for (const profile of ['release', 'debug']) {
            const candidate = path.join(directory, 'native', 'target', profile, BINARY_NAME);

            if (existsSync(candidate)) {
                return candidate;
            }
        }

        const parent = path.dirname(directory);

        if (parent === directory) {
            return undefined;
        }

        directory = parent;
    }
};

/** The prebuilt platform package's binary, when the installing machine's package is on disk.
 * Each package publishes no `exports` map on purpose, so the binary itself resolves by path.
 * The `existsSync` re-check turns a package without its binary into a fall-through to the
 * loud failure instead of a confusing spawn error later. */
const platformPackageBinary = (): string | undefined => {
    for (const name of platformPackageNames()) {
        try {
            const binary = requireFrom.resolve(`${name}/${BINARY_NAME}`);

            if (existsSync(binary)) {
                return binary;
            }
        } catch {
            // npm installs only the packages whose os/cpu/libc match, so on any machine every
            // candidate but one is simply absent.
        }
    }

    return undefined;
};

/** The platform package's binary through the `@react-carburetor/lint` launcher installed in the project.
 * The launcher is a dev dependency of the consumer's project and its `optionalDependencies` carry
 * the platform packages, which in an isolated (pnpm) layout are invisible from this file's own
 * position — so the lookup resolves `@react-carburetor/lint/package.json` from `process.cwd()` and
 * anchors a second `require` at the launcher's directory. A project without the launcher, or a
 * launcher whose platform package carries no binary, falls through silently. */
const launcherPackageBinary = (): string | undefined => {
    let launcherPackageJson: string;

    try {
        launcherPackageJson = createRequire(path.join(process.cwd(), 'noop.js'))
            .resolve('@react-carburetor/lint/package.json');
    } catch {
        // No launcher in the project: the hoisted walk may still find a platform package.
        return undefined;
    }

    const requireFromLauncher = createRequire(path.join(path.dirname(launcherPackageJson), 'noop.js'));

    for (const name of platformPackageNames()) {
        try {
            const binary = requireFromLauncher.resolve(`${name}/${BINARY_NAME}`);

            if (existsSync(binary)) {
                return binary;
            }
        } catch {
            // Only the platform package matching this machine is installed; the rest are absent.
        }
    }

    return undefined;
};

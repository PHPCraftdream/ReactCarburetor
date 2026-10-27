import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');
const manifest = (directory: string) => JSON.parse(read(`${directory}/package.json`)) as {
    name: string; version: string; os?: string[]; cpu?: string[]; libc?: string[]; files: string[];
    optionalDependencies?: Record<string, string>;
};

interface ILeg {
    package: string;
    os: string;
    container?: string;
    target: string;
    bin_ext?: string;
    expect: string;
    arch: string;
}

/** The legs of the platform-package matrix, as the workflow declares them. */
const legs = (): ILeg[] => read('.github/workflows/native-packages.yml')
    .split(/^\s+- package: /m).slice(1)
    .map(block => {
        const fields: Record<string, string> = {package: block.split('\n')[0].trim()};
        const leg = block.split(/^ {4}env:/m)[0];

        for (const match of leg.matchAll(/^\s+(\w+): (\S+)\s*$/gm)) {
            fields[match[1]] = match[2];
        }

        return fields as unknown as ILeg;
    });

/** The architecture suffix of a manylinux image name. */
const imageArch = (arch: string): string => (arch === 'x64' ? 'x86_64' : 'aarch64');

const NODE_OS: Record<string, string> = {windows: 'win32', darwin: 'darwin', linux: 'linux'};
const NODE_CPU: Record<string, string> = {x86_64: 'x64', aarch64: 'arm64'};

const parts = (triple: string) => {
    const [cpu, , system, abi] = triple.split('-');

    return {
        os: NODE_OS[system],
        cpu: NODE_CPU[cpu],
        abi: abi === 'gnu' || abi === 'musl' ? abi : undefined,
    };
};

/** npm's `libc` value for a target ABI. */
const NPM_LIBC: Record<string, string> = {gnu: 'glibc', musl: 'musl'};

describe('the platform packages', () => {
    const launcher = manifest('npm/lint');
    const platformDirectories = readdirSync(path.join(ROOT, 'npm'))
        .filter(name => name.startsWith('lint-')).sort((a, b) => a.localeCompare(b));

    test('the matrix, the launcher and the npm directory name the same packages', () => {
        const matrix = legs().map(leg => leg.package).sort((a, b) => a.localeCompare(b));

        expect(matrix.length).toBeGreaterThan(0);
        const scoped = matrix.map(name => `@react-carburetor/${name}`);

        expect(Object.keys(launcher.optionalDependencies ?? {}).sort((a, b) => a.localeCompare(b))).toEqual(scoped);
        expect(platformDirectories).toEqual(matrix);
    });

    test('every package is the root version and the launcher pins exactly it', () => {
        const root = JSON.parse(read('package.json')) as {version: string};

        expect(launcher.version).toEqual(root.version);

        for (const name of platformDirectories) {
            expect(manifest(`npm/${name}`).version).toEqual(root.version);
            expect(launcher.optionalDependencies?.[`@react-carburetor/${name}`]).toEqual(root.version);
        }
    });

    const cases = legs().map(leg => [leg.package, leg] as const);

    test.each(cases)('%s is built for what its manifest declares', (name, leg) => {
        const declared = manifest(`npm/${name}`);
        const target = parts(leg.target);
        const packageOs = target.os === 'win32' ? 'w32' : target.os;
        const suffix = [packageOs, target.cpu, target.abi].filter(Boolean).join('-');

        expect(name).toEqual(`lint-${suffix}`);
        expect(declared.name).toEqual(`@react-carburetor/${name}`);
        expect(declared.os).toEqual([target.os]);
        expect(declared.cpu).toEqual([target.cpu]);
        expect(declared.libc).toEqual(target.abi ? [NPM_LIBC[target.abi]] : undefined);
        expect(leg.arch).toEqual(target.cpu);
        expect(declared.files).toContain(`carburetor-lint${leg.bin_ext ?? ''}`);
        expect(declared.files).toContain('THIRD-PARTY-LICENSES.txt');
    });

    test.each(cases)('%s is checked for the portability its target promises', (_name, leg) => {
        const expected = leg.target.includes('windows') ? 'windows'
            : leg.target.includes('apple') ? 'macos'
                : leg.target.endsWith('musl') ? 'musl' : 'gnu';

        expect(leg.expect).toEqual(expected);
        // The glibc floor is only real when the glibc legs build against an old glibc.
        expect(Boolean(leg.container)).toEqual(expected === 'gnu');

        if (leg.container) {
            expect(leg.container).toContain('manylinux_2_28');
            expect(leg.container.endsWith(imageArch(leg.arch))).toBe(true);
        }
    });
});

describe('the platform-package workflow', () => {
    const workflow = read('.github/workflows/native-packages.yml');

    test('pins the toolchain it builds shipped binaries with', () => {
        expect(workflow).toMatch(/^\s+RUST_VERSION: \d+\.\d+\.\d+$/m);
    });

    test('builds locked, so a binary matches Cargo.lock', () => {
        expect(workflow).toContain('cargo build --release --locked');
    });

    test('ci.yml calls it instead of repeating the matrix', () => {
        const ci = read('.github/workflows/ci.yml');

        expect(ci).toContain('uses: ./.github/workflows/native-packages.yml');
        expect(ci).not.toContain('package: lint-');
    });

    test('shell scripts keep LF endings on every checkout', () => {
        expect(read('.gitattributes')).toMatch(/^\*\.sh text eol=lf$/m);
        expect(read('scripts/tools/release/ci/installRust.sh')).not.toContain('\r');
    });

    test('links the Windows C runtime statically', () => {
        expect(read('native/.cargo/config.toml')).toContain('target-feature=+crt-static');
    });
});

describe('the release workflows', () => {
    const release = read('.github/workflows/release.yml');
    const postPublish = read('.github/workflows/post-publish.yml');

    test('every action is pinned to a commit, as in ci.yml', () => {
        for (const file of readdirSync(path.join(ROOT, '.github/workflows'))) {
            const uses = [...read(`.github/workflows/${file}`).matchAll(/^\s+(?:- )?uses: (\S+)/gm)]
                .map(match => match[1])
                .filter(name => !name.startsWith('./'));

            for (const name of uses) {
                expect(`${file}: ${name}`).toMatch(/@[0-9a-f]{40}$/);
            }
        }
    });

    test('the release takes its platform list from the launcher and publishes it first', () => {
        expect(release).toContain('platforms=${platforms.join(" ")}');
        expect(release).toContain('for name in $PLATFORMS @react-carburetor/lint @react-carburetor/core; do');
        expect(release).toContain('uses: ./.github/workflows/audit.yml');
        expect(release).toContain('uses: ./.github/workflows/post-publish.yml');
    });

    test('the release starts a full-tier run for its own commit instead of failing without one', () => {
        expect(release).toContain('gh workflow run ci.yml --ref master');
        expect(release).toContain('headSha == \\"$GITHUB_SHA\\"');
        expect(release).toContain('gh run watch "$run" --exit-status');
    });

    test('the release requires the attribution in every platform tarball and a changelog section', () => {
        expect(release).toContain("grep -q '^package/THIRD-PARTY-LICENSES.txt$'");
        expect(release).toContain('CHANGELOG.md has no');
    });

    test('post-publish verifies every platform package, and the oldest glibc the binaries promise', () => {
        const names = [...postPublish.matchAll(/^\s+- name: (.+)$/gm)].map(match => match[1]);

        const platformPackages = readdirSync(path.join(ROOT, 'npm'))
            .filter(entry => entry.startsWith('lint-'));

        for (const directory of platformPackages) {
            const suffix = directory.replace('lint-', '');

            expect(names.some(name => name.startsWith(suffix))).toBe(true);
        }

        expect(postPublish).toContain('image: almalinux:8');
        expect(postPublish).toContain('node:24-alpine');
    });
});

describe('installing only the binary of the machine', () => {
    const launcher = manifest('npm/lint');
    const platformDirectories = readdirSync(path.join(ROOT, 'npm'))
        .filter(name => name.startsWith('lint-'));

    test('the launcher reaches the binaries only through optionalDependencies', () => {
        expect(Object.keys(launcher.optionalDependencies ?? {}).length).toBeGreaterThan(0);
        expect((launcher as {dependencies?: unknown}).dependencies).toBeUndefined();
    });

    test.each(platformDirectories)('%s declares os and cpu, and libc on linux, and runs nothing at install', name => {
        const declared = manifest(`npm/${name}`) as ReturnType<typeof manifest> & {
            scripts?: unknown; bin?: unknown; preferUnplugged?: boolean;
        };

        expect(declared.os?.length).toEqual(1);
        expect(declared.cpu?.length).toEqual(1);
        expect(declared.libc?.length ?? 0).toEqual(declared.os?.[0] === 'linux' ? 1 : 0);
        expect(declared.scripts).toBeUndefined();
        expect(declared.bin).toBeUndefined();
        // Yarn Plug'n'Play would otherwise keep the binary inside a zip, where it cannot be executed.
        expect(declared.preferUnplugged).toBe(true);
    });

    test('no two platform packages describe the same machine', () => {
        const machines = platformDirectories.map(name => {
            const declared = manifest(`npm/${name}`);

            return [declared.os?.[0], declared.cpu?.[0], declared.libc?.[0] ?? ''].join('/');
        });

        expect(new Set(machines).size).toEqual(machines.length);
    });

    test('the Node floor of the library and of the launcher is the same', () => {
        const root = JSON.parse(read('package.json')) as {engines: {node: string}};
        const declared = launcher as {engines?: {node: string}};

        expect(root.engines.node).toEqual('>=24.0.0');
        expect(declared.engines?.node).toEqual(root.engines.node);
    });

    test('the gating job offers every package to every supported machine and expects its own', () => {
        const workflow = read('.github/workflows/native-packages.yml');
        const section = workflow.slice(workflow.indexOf('\n  gating:'));
        const expected = [...section.matchAll(/^\s+expect: '@react-carburetor\/(lint-\S+)'$/gm)].map(match => match[1]);

        expect(expected.length).toEqual(platformDirectories.length);
        expect([...expected].sort((a, b) => a.localeCompare(b)))
            .toEqual([...platformDirectories].sort((a, b) => a.localeCompare(b)));
        expect(section).toContain('image: node:24-alpine');
        expect(section).toContain('--expect ${{ matrix.expect }}');
    });
});

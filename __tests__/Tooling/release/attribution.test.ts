import {mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {collectShipped} from '../../../scripts/tools/release/attribution/collectShipped.mjs';
import {licenseFiles} from '../../../scripts/tools/release/attribution/licenseFiles.mjs';
import {renderThirdParty} from '../../../scripts/tools/release/attribution/renderThirdParty.mjs';
import {TARGETS} from '../../../scripts/tools/release/attribution/thirdParty.mjs';

const ROOT = process.cwd();
const ATTRIBUTION = path.join(ROOT, 'scripts/tools/release/attribution');

interface IDep {
    pkg: string;
    dep_kinds: Array<{kind: string | null}>;
}

const pkg = (name: string, version = '1.0.0', kinds: string[] = ['lib']) => ({
    id: `${name} ${version}`, name, version, license: 'MIT', repository: `https://example.test/${name}`,
    manifest_path: path.join('/registry', `${name}-${version}`, 'Cargo.toml'),
    targets: [{kind: kinds}],
});

const node = (name: string, deps: IDep[] = [], version = '1.0.0') => ({id: `${name} ${version}`, deps});
const edge = (name: string, kind: string | null = null, version = '1.0.0'): IDep =>
    ({pkg: `${name} ${version}`, dep_kinds: [{kind}]});

describe('collectShipped', () => {
    const metadata = {
        packages: [
            pkg('root'), pkg('linked'), pkg('deep'), pkg('builder'), pkg('tester'),
            pkg('macros', '1.0.0', ['proc-macro']), pkg('hidden-by-macros'), pkg('deep', '2.0.0'),
        ],
        workspace_members: ['root 1.0.0'],
        resolve: {
            nodes: [
                node('root', [edge('linked'), edge('builder', 'build'), edge('tester', 'dev'), edge('macros')]),
                node('linked', [edge('deep'), edge('deep', null, '2.0.0')]),
                node('deep'), node('deep', [], '2.0.0'), node('builder'), node('tester'),
                node('macros', [edge('hidden-by-macros')]), node('hidden-by-macros'),
            ],
        },
    };

    test('follows normal dependencies only, skipping build, dev and procedural-macro crates', () => {
        const shipped = collectShipped(metadata);

        expect(shipped.map((crate: {name: string; version: string}) => `${crate.name}@${crate.version}`))
            .toEqual(['deep@1.0.0', 'deep@2.0.0', 'linked@1.0.0']);
        expect(shipped[0].directory).toEqual(path.join('/registry', 'deep-1.0.0'));
        expect(shipped[0].license).toEqual('MIT');
    });

    test('reports a missing license as UNKNOWN rather than dropping the crate', () => {
        const bare = {...metadata, packages: metadata.packages.map(item => ({...item, license: null}))};

        expect(collectShipped(bare)[0].license).toEqual('UNKNOWN');
    });

    test('rejects malformed metadata and dangling dependencies', () => {
        expect(() => collectShipped({})).toThrow('Invalid Cargo metadata');
        expect(() => collectShipped({...metadata, workspace_members: []})).toThrow('no workspace members');
        expect(() => collectShipped({
            ...metadata,
            resolve: {nodes: [node('root', [edge('missing')])]},
        })).toThrow('missing');
    });
});

describe('licenseFiles', () => {
    let directory = '';

    beforeEach(() => {
        directory = mkdtempSync(path.join(os.tmpdir(), 'attribution-'));
    });

    afterEach(() => {
        rmSync(directory, {recursive: true, force: true});
    });

    test('reads license and notice files at the top level, normalized and sorted', () => {
        writeFileSync(path.join(directory, 'LICENSE-MIT'), 'MIT text\r\nsecond line\r\n');
        writeFileSync(path.join(directory, 'LICENSE-APACHE'), 'Apache text\n');
        writeFileSync(path.join(directory, 'NOTICE'), 'Notice\n');
        writeFileSync(path.join(directory, 'license'), 'lower case\n');
        writeFileSync(path.join(directory, 'README.md'), 'not a license\n');
        writeFileSync(path.join(directory, 'LICENSE-EMPTY'), '  \n');
        mkdirSync(path.join(directory, 'LICENSES'));
        writeFileSync(path.join(directory, 'LICENSES', 'nested'), 'ignored\n');

        const files = licenseFiles(directory);

        expect(files.map((file: {name: string}) => file.name))
            .toEqual(['LICENSE-APACHE', 'LICENSE-MIT', 'NOTICE', 'license']);
        expect(files.find((file: {name: string}) => file.name === 'LICENSE-MIT').text)
            .toEqual('MIT text\nsecond line');
    });

    test('an empty directory has no license files', () => {
        expect(licenseFiles(directory)).toEqual([]);
    });
});

describe('renderThirdParty', () => {
    const mit = 'Copyright (c) A\n\nPermission is hereby granted';
    const crates = [
        {name: 'zeta', version: '1.0.0', license: 'MIT', repository: null, files: [{name: 'LICENSE', text: mit}]},
        {
            name: 'alpha', version: '2.0.0', license: 'MIT OR Apache-2.0', repository: 'https://example.test/alpha',
            files: [{name: 'LICENSE-MIT', text: mit}, {name: 'LICENSE-APACHE', text: 'Apache License text'}],
        },
        {
            name: 'oxc', version: '0.1.0', license: 'MIT', repository: 'https://example.test/oxc',
            files: [{name: 'LICENSE', text: 'Supplement text', source: 'https://example.test/oxc/LICENSE'}],
        },
    ];

    test('prints each distinct text once, naming every crate that carries it', () => {
        const text = renderThirdParty(crates);
        // The musl notice carries its own MIT text; count only the crate texts after it.
        const crateTexts = text.slice(text.indexOf('License texts'));

        expect(crateTexts.split('Permission is hereby granted').length - 1).toEqual(1);
        expect(text).toContain('alpha 2.0.0, zeta 1.0.0');
        expect(text).toContain('Rust crates (3)');
        expect(text).toContain('alpha 2.0.0 - MIT OR Apache-2.0 - https://example.test/alpha');
    });

    test('lists a supplement together with where its text came from', () => {
        expect(renderThirdParty(crates))
            .toContain('(the published crates ship no license file; text from https://example.test/oxc/LICENSE)');
    });

    test('is independent of input order and ends with a single newline', () => {
        const forward = renderThirdParty(crates);
        const backward = renderThirdParty([...crates].reverse());

        expect(backward).toEqual(forward);
        expect(forward.endsWith('\n')).toBe(true);
        expect(forward.endsWith('\n\n')).toBe(false);
    });

    test('states the statically linked musl runtime', () => {
        expect(renderThirdParty(crates)).toContain('musl libc (the @react-carburetor/lint-linux-*-musl packages only)');
    });
});

describe('the committed attribution file', () => {
    const committed = readFileSync(path.join(ROOT, 'native/THIRD-PARTY-LICENSES.txt'), 'utf8');
    const lock = readFileSync(path.join(ROOT, 'native/Cargo.lock'), 'utf8').split('\r\n').join('\n');
    const locked = new Set([...lock.matchAll(/name = "([^"]+)"\nversion = "([^"]+)"/g)]
        .map(match => `${match[1]} ${match[2]}`));
    const list = committed.slice(committed.indexOf('Rust crates ('), committed.indexOf('musl libc ('));
    const listed = [...list.matchAll(/^([A-Za-z0-9_.-]+) (\d[^ ]*) - .+$/gm)]
        .map(match => `${match[1]} ${match[2]}`);

    test('lists only crates that Cargo.lock pins, as many as its header says', () => {
        const declared = Number(/^Rust crates \((\d+)\)$/m.exec(committed)?.[1]);

        expect(declared).toBeGreaterThan(0);
        expect(listed.length).toEqual(declared);
        expect(listed.filter(entry => !locked.has(entry))).toEqual([]);
    });

    test('carries the license text for every listed crate', () => {
        const texts = committed.slice(committed.indexOf('License texts'));
        const named = new Set([...texts.matchAll(/^\[\d+\] (.+)$/gm)]
            .flatMap(match => match[1].split(', ')));

        expect(listed.filter(entry => !named.has(entry))).toEqual([]);
    });
});

describe('the attribution targets', () => {
    test('are the cargo targets of the platform-package matrix', () => {
        const workflow = readFileSync(path.join(ROOT, '.github/workflows/native-packages.yml'), 'utf8');
        const matrix = [...workflow.matchAll(/^\s+target: (\S+)$/gm)].map(match => match[1]);

        const byName = (a: string, b: string): number => a.localeCompare(b);

        expect([...TARGETS].sort(byName)).toEqual([...new Set(matrix)].sort(byName));
    });

    test('every supplement names an existing license file', () => {
        const supplements = JSON.parse(readFileSync(path.join(ATTRIBUTION, 'supplements.json'), 'utf8')) as
            Array<{repository: string; source: string; file: string}>;

        expect(supplements.length).toBeGreaterThan(0);

        for (const entry of supplements) {
            expect(existsSync(path.join(ATTRIBUTION, entry.file))).toBe(true);
            expect(entry.source.startsWith(entry.repository)).toBe(true);
        }
    });
});

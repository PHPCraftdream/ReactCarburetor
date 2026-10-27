import {readFileSync} from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const LICENSES = ['LICENSE', 'LICENSE-MIT', 'LICENSE-APACHE'];
const PACKAGES = [
    'lint',
    'lint-darwin-arm64',
    'lint-darwin-x64',
    'lint-linux-arm64-gnu',
    'lint-linux-arm64-musl',
    'lint-linux-x64-gnu',
    'lint-linux-x64-musl',
    'lint-w32-arm64',
    'lint-w32-x64',
];

interface IPackageManifest {
    files: string[];
    license: string;
}

const PLATFORM_PACKAGES = PACKAGES.filter((name: string) => name !== 'lint');

describe('third-party attribution in the platform packages', () => {
    test.each(PLATFORM_PACKAGES)('%s ships the attribution for its statically linked crates', (name: string) => {
        const manifest = JSON.parse(
            readFileSync(path.join(ROOT, 'npm', name, 'package.json'), 'utf8')
        ) as IPackageManifest;

        expect(manifest.files).toContain('THIRD-PARTY-LICENSES.txt');
    });

    test('the launcher carries no binary, so no attribution file', () => {
        const manifest = JSON.parse(
            readFileSync(path.join(ROOT, 'npm', 'lint', 'package.json'), 'utf8')
        ) as IPackageManifest;

        expect(manifest.files).not.toContain('THIRD-PARTY-LICENSES.txt');
    });
});

describe('dual-license package contents', () => {
    test.each(PACKAGES)('%s carries the root license texts', (name: string) => {
        const directory = path.join(ROOT, 'npm', name);
        const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')) as IPackageManifest;

        expect(manifest.license).toEqual('MIT OR Apache-2.0');

        LICENSES.forEach((license: string) => {
            expect(manifest.files).toContain(license);
            expect(readFileSync(path.join(directory, license), 'utf8'))
                .toEqual(readFileSync(path.join(ROOT, license), 'utf8'));
        });
    });
});

import {readFileSync} from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const LICENSES = ['LICENSE', 'LICENSE-MIT', 'LICENSE-APACHE'];
const PACKAGES = [
    'carburetor-lint',
    'carburetor-lint-darwin-arm64',
    'carburetor-lint-darwin-x64',
    'carburetor-lint-linux-arm64-gnu',
    'carburetor-lint-linux-x64-gnu',
    'carburetor-lint-linux-x64-musl',
    'carburetor-lint-win32-x64',
];

interface IPackageManifest {
    files: string[];
    license: string;
}

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

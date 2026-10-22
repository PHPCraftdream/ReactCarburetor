import {createHash} from 'node:crypto';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

const filesUnder = (root, directory) => readdirSync(join(root, directory), {withFileTypes: true})
    .flatMap(entry => entry.isDirectory()
        ? filesUnder(root, join(directory, entry.name))
        : [join(directory, entry.name)]);

/**
 * Hashes sorted framework sources and metadata, normalizing line endings.
 *
 * @param root Framework checkout root.
 */
export const sourceHash = root => {
    const paths = ['lib/src', 'plugin/src'].flatMap(directory => filesUnder(root, directory));
    paths.push('rslib.config.ts', 'package.json');
    const sortedPaths = paths.map(path => path.split('\\').join('/'))
        .sort((left, right) => (left < right ? -1 : Number(left > right)));
    const hash = createHash('sha256');

    for (const path of sortedPaths) {
        const content = readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
        hash.update(path);
        hash.update('\0');
        hash.update(content);
        hash.update('\0');
    }

    return hash.digest('hex');
};

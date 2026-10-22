import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceHash} from './sourceHash.mjs';

const scriptRoot = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * Checks whether the checkout's build stamp matches its current package and sources.
 *
 * @param root Framework checkout root.
 */
export const checkDistFresh = root => {
    let info;

    try {
        info = JSON.parse(readFileSync(join(root, 'dist', 'build-info.json'), 'utf8'));
    } catch {
        return {fresh: false, message: 'no build stamp: dist was not built here'};
    }

    try {
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
        const fresh = info.name === pkg.name && info.version === pkg.version && info.sourceHash === sourceHash(root);

        return fresh
            ? {fresh: true, message: ''}
            : {fresh: false, message: 'dist is stale (sources changed since the last build): run npm run build'};
    } catch {
        return {fresh: false, message: 'dist is stale (sources changed since the last build): run npm run build'};
    }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = resolve(process.argv[2] || scriptRoot);
    const result = checkDistFresh(root);

    if (!result.fresh) {
        console.error(result.message);
        process.exitCode = 1;
    }
}

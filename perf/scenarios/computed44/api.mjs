import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {distRoot} from '../../harness/lib.mjs';

/** Loads the selected distribution without copying it; mixed lanes require a sibling format.
 *
 * @param mixed - Whether to load an independent sibling-format API.
 */
export const api = async (mixed = false) => {
    const open = async root => {
        const esm = resolve(root, 'Carburetor/index.mjs');
        if (existsSync(esm)) return import(pathToFileURL(esm).href);
        return createRequire(import.meta.url)(resolve(root, 'Carburetor/index.js'));
    };
    const primary = await open(distRoot);
    const module = async relative => {
        const esm = resolve(distRoot, relative + '.mjs');
        if (existsSync(esm)) return import(pathToFileURL(esm).href);
        return createRequire(import.meta.url)(resolve(distRoot, relative + '.js'));
    };
    if (!mixed) return {primary, peer: primary, module};
    const sibling = process.env.MIXED_DIST_ROOT ?? resolve(dirname(distRoot),
        existsSync(resolve(distRoot, 'Carburetor/index.mjs')) ? 'cjs' : 'esm');
    const peer = await open(sibling);
    if (primary.computed === peer.computed) throw new Error('mixed control requires independent format copies');
    return {primary, peer, module};
};

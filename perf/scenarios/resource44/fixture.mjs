/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const option = (name, fallback) => {
    const at = process.argv.indexOf('--' + name);
    return at < 0 ? fallback : process.argv[at + 1];
};
const root = resolve(process.env.DIST_ROOT ?? option('root', 'dist/esm-prod'));
process.env.NODE_ENV = option('env', process.env.NODE_ENV ?? 'production');
const require = createRequire(import.meta.url);
export const api = existsSync(resolve(root, 'Carburetor/index.mjs'))
    ? await import(pathToFileURL(resolve(root, 'Carburetor/index.mjs')).href)
    : require(resolve(root, 'Carburetor/index.js'));
export const ready = data => ({status: api.EResourceStatus.Success, data, error: undefined,
    updatedAt: Date.now(), refreshing: false, invalidated: false, failed: false});
export const gate = () => {
    let yes, no;
    const promise = new Promise((resolve, reject) => { yes = resolve; no = reject; });
    return {promise, yes, no};
};
export const rejected = (style, describe) => style === 'object' ? {toString: describe}
    : Object.defineProperty(new Error('unused'), 'message', {get: describe});

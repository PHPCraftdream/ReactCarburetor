/* oxlint-disable react/globals, carburetor/require-tsdoc */
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const require = createRequire(import.meta.url);
export const dist = resolve(process.env.DIST_ROOT ?? 'dist/esm-prod');
export const load = (part, directory = dist, resolver = require) =>
    existsSync(resolve(directory, part, 'index.mjs'))
        ? import(pathToFileURL(resolve(directory, part, 'index.mjs')).href)
        : Promise.resolve(resolver(resolve(directory, part, 'index.js')));
export function setupDOM() {
    const {JSDOM} = require('jsdom');
    const dom = new JSDOM('<!doctype html><body></body>', {url: 'http://localhost/'});
    for (const key of ['window', 'document', 'HTMLElement', 'Node']) globalThis[key] = dom.window[key];
    return dom;
}
export const emit = metrics => console.log('@@ ' + JSON.stringify(metrics));

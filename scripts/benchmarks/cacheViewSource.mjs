import {mkdtempSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {rspack} from '@rspack/core';

/** Bundle cache benchmark source without changing the tracked distribution.
 *
 * @param root - Repository root.
 * @param entries - Named source entry points.
 */
export const loadSource = async (root, entries) => {
    const output = mkdtempSync(join(tmpdir(), 'carburetor-benchmark-'));
    const compiler = rspack({
        context: root, mode: 'none', target: 'node', devtool: false,
        entry: Object.fromEntries(Object.entries(entries).map(([name, file]) => [name, resolve(root, file)])),
        output: {path: output, filename: '[name].cjs', library: {type: 'commonjs2'}},
        resolve: {extensions: ['.ts', '.js'], alias: {'@': resolve(root, 'lib/src')}},
        module: {rules: [{test: /\.ts$/, loader: 'builtin:swc-loader',
            options: {jsc: {parser: {syntax: 'typescript'}, target: 'es2020'}}}]},
    });

    try {
        await new Promise((done, fail) => compiler.run((error, stats) => {
            if (error || stats.hasErrors()) {
                fail(error || new Error(stats.toString({all: false, errors: true})));
            } else {
                done();
            }
        }));

        const require = createRequire(import.meta.url);

        return Object.fromEntries(Object.keys(entries).map((name) => [name, require(join(output, `${name}.cjs`))]));
    } finally {
        await new Promise((done, fail) => compiler.close((error) => error ? fail(error) : done()));
        rmSync(output, {recursive: true, force: true});
    }
};

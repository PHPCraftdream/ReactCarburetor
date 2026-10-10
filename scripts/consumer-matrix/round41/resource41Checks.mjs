import {writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {run} from '../matrix.mjs';

/** Runs the compiled strict fixture with the cell's own React/DOM, in both module formats.
 *
 * @param formatDir - compiled packed consumer directory.
 * @param format - module format under test.
 * @param condition - public export condition exercised by this cell.
 */
export const resource41Checks = (formatDir, format, condition) => {
    const fixture = format === 'esm'
        ? "const fixture = await import('./out/consumer.js');"
        : "const fixture = require('./out/consumer.js');";
    const jsdom = createRequire(import.meta.url).resolve('jsdom');
    const imports = format === 'esm'
        ? `import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {JSDOM} from ${JSON.stringify(pathToFileURL(jsdom).href)};
`
        : `const React = require('react');
const {createRoot} = require('react-dom/client');
const {flushSync} = require('react-dom');
const {JSDOM} = require(${JSON.stringify(jsdom)});
`;
    const body = `
const dom = new JSDOM('<div id="root"></div>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true});
${fixture}
const {Resource41Consumer, Resource41ClassConsumer, Resource41OverrideConsumer,
    resource41, resource41Control, resource41Counts} = fixture;
await resource41.load('user');
await resource41Control.load('user');
const container = document.getElementById('root');
const root = createRoot(container);
const failures = [];
const check = (name, ok) => { if (!ok) failures.push(name); };
const drain = async () => { await new Promise(resolve => setTimeout(resolve, 20)); flushSync(() => {}); };
const tree = tick => React.createElement(React.Fragment, null,
    React.createElement(Resource41Consumer, {tick}), React.createElement(Resource41ClassConsumer, {tick}));
try {
    flushSync(() => root.render(tree(0)));
    check('mount DOM', container.textContent === 'AdaAda');
    flushSync(() => root.render(tree(1)));
    check('memo parent bailout', resource41Counts.child === 1);
    check('class parent bailout control', resource41Counts.control === 1);
    const parents = resource41Counts.parent;
    const children = resource41Counts.child;
    flushSync(() => resource41.edit('unread', 1));
    await drain();
    check('nested unread parent precision', resource41Counts.parent === parents);
    check('nested unread child precision', resource41Counts.child === children);
    flushSync(() => { resource41.edit('name', 'Grace'); resource41Control.edit('name', 'Grace'); });
    await drain();
    check('committed leaf delivery after bailout', resource41Counts.child === children + 1);
    check('class leaf delivery control', resource41Counts.control === 2);
    check('retained detached snapshot', fixture.resource41Retained.nested.name === 'Ada');
    check('updated DOM', container.textContent === 'GraceGrace');
    flushSync(() => root.render(React.createElement(fixture.Resource41NativeConsumer)));
    check('native detached DOM', container.textContent === 'Grace:123:Ada:1');
    flushSync(() => root.render(React.createElement(Resource41OverrideConsumer)));
    check('local override DOM', container.textContent === 'local');
    check('local override preserves cache', resource41.getEntry('user').data.nested.name === 'Grace');
    flushSync(() => root.render(React.createElement(Resource41Consumer, {tick: 2})));
    check('base selection after overlay', container.textContent === 'Grace');
    const alternateEngine = ${format === 'esm'
        ? "await import('node:module').then(({createRequire}) => createRequire(import.meta.url)('react-carburetor'))"
        : "await import('react-carburetor')"};
    const alternateInterop = ${format === 'esm'
        ? "await import('node:module').then(({createRequire}) => createRequire(import.meta.url)('react-carburetor/interop'))"
        : "await import('react-carburetor/interop')"};
    const crossSource = new alternateEngine.ResourceCache(
        async () => ({nested: {name: 'cross', unread: 0}}), {ttl: Infinity});
    await crossSource.load('user');
    flushSync(() => root.render(React.createElement(fixture.Resource41CrossConsumer, {source: crossSource})));
    check('foreign source current hook', container.textContent === 'cross');
    const ForeignHook = () => React.createElement('span', null,
        alternateInterop.useResourceValue(resource41, 'user', view => view.data.nested.name));
    flushSync(() => root.render(React.createElement(ForeignHook)));
    check('current source foreign hook', container.textContent === 'Grace');
} finally {
    flushSync(() => root.unmount());
    dom.window.close();
}
if (failures.length) throw new Error('R41 resource checks failed: ' + failures.join(', '));
`;
    const filename = format === 'esm' ? 'resource41.mjs' : 'resource41.cjs';
    const wrappedBody = '\n(async () => {' + body +
        '\n})().catch(error => {console.error(error); process.exitCode = 1;});';
    writeFileSync(path.join(formatDir, filename), imports + (format === 'esm' ? body : wrappedBody));
    const result = run(process.execPath, ['--conditions=' + condition, filename], {
        cwd: formatDir, env: {...process.env, NODE_ENV: condition},
    });
    return result.ok ? {ok: true} : {ok: false, stage: 'resource41', stderr: result.stdout + result.stderr};
};

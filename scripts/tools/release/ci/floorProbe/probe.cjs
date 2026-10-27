/* oxlint-disable carburetor/require-tsdoc -- a throwaway probe in old syntax, not library code */
'use strict';
// Runs unchanged on every Node the matrix installs (the declared floor up to the newest release),
// so it sticks to plain syntax and the one public API surface it exercises.
// Usage: node probe.cjs require-development|require-production|import-development|import-production
const path = require('path');
const pathToFileURL = require('url').pathToFileURL;
const React = require('react');
const renderToString = require('react-dom/server').renderToString;

// dist/cjs/Carburetor/index.js is the package's CJS entry; the package root exports no package.json.
const dist = path.resolve(path.dirname(require.resolve('@react-carburetor/core')), '..', '..');

const fail = function (message) {
  console.error('probe: ' + message);
  process.exit(1);
};

const exercise = function (label, lib) {
  if (typeof lib.Carburetor !== 'function') fail(label + ': Carburetor is not exported');
  if (typeof lib.AntiHookComponent !== 'function') fail(label + ': AntiHookComponent is not exported');

  class Counter extends lib.Carburetor {
    inc() {
      this.draft.n++;
      this.emitUpdate();
    }
  }

  const store = new Counter({n: 0});
  let notified = 0;
  store.subscribe(function () { notified++; }, {id: 'probe', reads: new Set(['n'])});
  store.inc();
  if (store.getData().n !== 1 || notified !== 1) fail(label + ': a write did not reach its subscriber');

  class View extends lib.AntiHookComponent {
    render() {
      const data = this.useCarburetor(store);
      return React.createElement('p', null, data.n);
    }
  }

  const html = renderToString(React.createElement(View));
  if (html.indexOf('>1<') === -1) fail(label + ': server render gave ' + html);
  console.log('probe: ' + label + ' ok on node ' + process.version);
};

// One flavor per process: loading two builds or module formats together is the duplicate-copy
// situation the library itself reports.
const flavor = process.argv[2];

if (flavor === 'require-development') {
  require('@react-carburetor/core/interop');
  require('@react-carburetor/core/testing');
  exercise(flavor, require('@react-carburetor/core'));
} else if (flavor === 'require-production') {
  exercise(flavor, require(path.join(dist, 'cjs-prod', 'Carburetor', 'index.js')));
} else if (flavor === 'import-development' || flavor === 'import-production') {
  const folder = flavor === 'import-production' ? 'esm-prod' : 'esm';

  import(pathToFileURL(path.join(dist, folder, 'Carburetor', 'index.mjs')).href)
    .then(function (lib) { exercise(flavor, lib); })
    .catch(function (error) { fail(flavor + ' failed: ' + (error && error.stack || error)); });
} else {
  fail('usage: probe.cjs require-development|require-production|import-development|import-production');
}

/* oxlint-disable react/globals, carburetor-internal/require-tsdoc */
import {emit, load, require, setupDOM} from './fixture.mjs';
import {checkOwnership} from '../components42/checks.mjs';
process.env.NODE_ENV = 'development';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const dom = setupDOM();
const React = require('react');
const {createRoot} = require('react-dom/client');
const env = {React, createRoot, api: await load('Carburetor'), interop: await load('Interop')};
let lanes = 0, releasedOwners = 0;
try {
    for (const self of [true, false]) for (const strict of [true, false]) {
        for (const resume of [true, false]) for (const swap of [true, false]) {
            const result = await checkOwnership(env, {kind: 'raw', self, strict, resume, swap});
            releasedOwners += result.releasedOwners;
            lanes++;
        }
    }
    emit({lanes, releasedOwners});
} finally { dom.window.close(); }

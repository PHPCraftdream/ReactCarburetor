import * as React from 'react';
import {createRoot} from 'react-dom/client';
import * as api from '@/Carburetor';
import * as interop from '@/Interop';
import {
    checkRemoval, checkDisarm, checkRefresh, checkWarm,
} from '../../../../../../perf/scenarios/resource42/checks.mjs';
import {checkMultiEntry} from '../../../../../../perf/scenarios/resource42/multi-entry.mjs';
import {checkSelectorBoundary, checkPreloaderDisarm} from '../../../../../../perf/scenarios/resource42/boundaries.mjs';

import {enableReactActEnvironment} from '../../../../../reactActEnvironment';

enableReactActEnvironment();

const env = {React, createRoot, api, interop};
describe('R42-R01 committed loading demand', () => {
    for (const action of ['abort', 'forget', 'restore', 'forgetAll']) {
        for (const phase of ['before', 'after', 'replacement']) for (const strict of [false, true]) {
            test(`${action} / ${phase}-loader removal / strict=${strict} / no parent rescue`, async () => {
                await checkRemoval(env, {action, phase, strict});
            });
        }
        test(`${action} retained-success refresh and successful/failed rearm`, async () => {
            await checkRefresh(env, 'hook', action);
        });
    }
    for (const kind of ['hook', 'class']) for (const mode of ['source', 'args', 'unmount']) {
        for (const strict of [false, true]) {
            test(`${kind} ${mode} disarms obsolete settlement / strict=${strict}`, async () => {
                await checkDisarm(env, {kind, mode, strict});
            });
        }
    }
    for (const strict of [false, true]) {
        test(`class multi-absent cold pair / strict=${strict} / frozen default contract`, async () => {
            await checkMultiEntry(env, {strict});
        });
        for (const action of ['abort', 'forget', 'restore']) for (const replacement of [false, true]) {
            test(`class first-key ${action} inside second loader / existing replacement=${replacement}` +
                ` / strict=${strict} / no parent or settlement rescue`, async () => {
                await checkMultiEntry(env, {action, replacement, strict});
            });
        }
    }
    test('throwing selector reaches a real React error boundary', async () => {
        await checkSelectorBoundary(env);
    });
    for (const kind of ['hook', 'class']) for (const mode of ['source', 'args', 'unmount']) {
        for (const strict of [false, true]) {
            test(`${kind} pre-loader supersession / ${mode} / strict=${strict}`, async () => {
                await checkPreloaderDisarm(env, {kind, mode, strict});
            });
        }
    }
    test('warm stable resource selector avoids child renders and reloads', async () => { await checkWarm(env); });
});

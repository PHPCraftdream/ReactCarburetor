import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';

const CJS_ROOT = path.resolve(process.cwd(), 'dist', 'cjs');
const ESM_ROOT = path.resolve(process.cwd(), 'dist', 'esm');

/**
 * Runs in a real child process rather than in-process: requiring dist/cjs and dynamically
 * importing dist/esm here would still go through jsdom/rstest's own module handling and the
 * `react$` alias in rstest.config.ts, which is not the shape a consumer's dual-format install
 * actually takes. A child process gives Node's own separate CJS/ESM module graphs.
 */
const SCRIPT = `
const path = require('path');

const toFileUrl = (file) => 'file:///' + path.resolve(file).split(path.sep).join('/');
const cjsRoot = process.env.CJS_ROOT;
const esmRoot = process.env.ESM_ROOT;

// Every shared slot (CarburetorContext, updateBatch, updateWave, invalidationEdges) reports
// once when the ESM side touches it after the CJS side already claimed it; capturing every
// console.error lets the test pick out the CarburetorContext one and check its exact wording.
const messages = [];
console.error = (...args) => messages.push(args.join(' '));

(async () => {
    const cjs = require(path.join(cjsRoot, 'Carburetor', 'index.js'));
    const esm = await import(toFileUrl(path.join(esmRoot, 'Carburetor', 'index.mjs')));

    const cjsContext = require(
        path.join(cjsRoot, 'Carburetor', 'Component', 'Scope', 'CarburetorContext.js')
    ).CarburetorContext;
    const esmContext = (await import(
        toFileUrl(path.join(esmRoot, 'Carburetor', 'Component', 'Scope', 'CarburetorContext.mjs'))
    )).CarburetorContext;

    const cjsBatch = require(
        path.join(cjsRoot, 'Carburetor', 'Store', 'Transaction', 'UpdateBatchInstance.js')
    ).updateBatch;
    const esmBatch = (await import(
        toFileUrl(path.join(esmRoot, 'Carburetor', 'Store', 'Transaction', 'UpdateBatchInstance.mjs'))
    )).updateBatch;

    const cjsWave = require(
        path.join(cjsRoot, 'Carburetor', 'Store', 'Scheduling', 'UpdateWaveInstance.js')
    ).updateWave;
    const esmWave = (await import(
        toFileUrl(path.join(esmRoot, 'Carburetor', 'Store', 'Scheduling', 'UpdateWaveInstance.mjs'))
    )).updateWave;

    class CjsStore extends cjs.Carburetor {
        bump(n) {
            this.draft.n = n;
            this.emitUpdate();
        }
    }

    class EsmStore extends esm.Carburetor {
        bump(n) {
            this.draft.n = n;
            this.emitUpdate();
        }
    }

    const order = [];
    const storeCjs = new CjsStore({n: 0});
    const storeEsm = new EsmStore({n: 0});

    storeCjs.subscribe(() => order.push('cjs'));
    storeEsm.subscribe(() => order.push('esm'));

    let midBody = null;

    cjs.transaction(() => {
        storeCjs.bump(1);
        storeEsm.bump(2);
        midBody = order.slice();
    });

    process.stdout.write(JSON.stringify({
        sameContext: cjsContext === esmContext,
        sameBatch: cjsBatch === esmBatch,
        sameWave: cjsWave === esmWave,
        midBody,
        afterBody: order.slice().sort(),
        messages,
    }));
})().catch((error) => {
    process.stderr.write(String((error && error.stack) || error));
    process.exit(1);
});
`;

/**
 * Reproduces the lost-settlement bug: getUid() used to be a module-local counter, so the
 * first computed built in each copy minted the same "carburetor-uid-1" id. UpdateWave.defer
 * keys its pending settlements by uid, so the second defer() call for that shared wave
 * silently replaced the first copy's settlement instead of adding to it.
 *
 * Each side consumes exactly one uid for its store and one for its computed, so the two
 * computeds land on the same ordinal id whenever getUid is not itself process-shared.
 */
const LOST_SETTLEMENT_SCRIPT = `
const path = require('path');

const toFileUrl = (file) => 'file:///' + path.resolve(file).split(path.sep).join('/');
const cjsRoot = process.env.CJS_ROOT;
const esmRoot = process.env.ESM_ROOT;

(async () => {
    const cjs = require(path.join(cjsRoot, 'Carburetor', 'index.js'));
    const esm = await import(toFileUrl(path.join(esmRoot, 'Carburetor', 'index.mjs')));

    class EsmCounter extends esm.Carburetor {
        inc() {
            this.draft.n = this.draft.n + 1;
            this.emitUpdate();
        }
    }

    class CjsCounter extends cjs.Carburetor {
        inc() {
            this.draft.n = this.draft.n + 1;
            this.emitUpdate();
        }
    }

    const storeEsm = new EsmCounter({n: 0});
    const storeCjs = new CjsCounter({n: 0});

    const computedEsm = esm.computed((read) => read(storeEsm).n);
    const computedCjs = cjs.computed((read) => read(storeCjs).n);

    let heardEsm = 0;
    let heardCjs = 0;

    computedEsm.subscribe(() => { heardEsm++; });
    computedCjs.subscribe(() => { heardCjs++; });

    cjs.transaction(() => {
        storeEsm.inc();
        storeCjs.inc();
    });

    process.stdout.write(JSON.stringify({
        computedUidsCollide: computedEsm.getUID() === computedCjs.getUID(),
        heardEsm,
        heardCjs,
    }));
})().catch((error) => {
    process.stderr.write(String((error && error.stack) || error));
    process.exit(1);
});
`;

/**
 * Reproduces the subscription-stealing shape of the same bug: carburetorToken's
 * duplicate-name check (\`takenNames\`) used to be a module-local Set, so a name claimed by
 * one copy was invisible to the other.
 */
const TOKEN_COLLISION_SCRIPT = `
const path = require('path');

const toFileUrl = (file) => 'file:///' + path.resolve(file).split(path.sep).join('/');
const cjsRoot = process.env.CJS_ROOT;
const esmRoot = process.env.ESM_ROOT;

const messages = [];
console.error = (...args) => messages.push(args.join(' '));

(async () => {
    const cjs = require(path.join(cjsRoot, 'Carburetor', 'index.js'));
    const esm = await import(toFileUrl(path.join(esmRoot, 'Carburetor', 'index.mjs')));

    cjs.carburetorToken(() => new cjs.Carburetor({value: 0}), 'dual-format/shared-name');
    const esmToken = esm.carburetorToken(() => new esm.Carburetor({value: 0}), 'dual-format/shared-name');

    process.stdout.write(JSON.stringify({esmTokenId: esmToken.id, messages}));
})().catch((error) => {
    process.stderr.write(String((error && error.stack) || error));
    process.exit(1);
});
`;

describe('sharedSingleton across a CJS/ESM split', () => {
    test('CarburetorContext/updateBatch/updateWave are one object across dist/cjs and dist/esm, and transaction() batches a store from either copy', () => {
        const cjsEntry = path.join(CJS_ROOT, 'Carburetor', 'index.js');
        const esmEntry = path.join(ESM_ROOT, 'Carburetor', 'index.mjs');

        if (!existsSync(cjsEntry) || !existsSync(esmEntry)) {
            throw new Error('the compiled package is missing: run npm run build first, this regression needs both dist/cjs and dist/esm');
        }

        const result = spawnSync(process.execPath, ['-e', SCRIPT], {
            encoding: 'utf8',
            env: {...process.env, CJS_ROOT, ESM_ROOT},
        });

        if (result.error) {
            throw result.error;
        }

        expect(result.status, result.stderr).toEqual(0);

        const parsed = JSON.parse(result.stdout);

        expect(parsed.sameContext).toBeTruthy();
        expect(parsed.sameBatch).toBeTruthy();
        expect(parsed.sameWave).toBeTruthy();
        // Neither store notified mid-transaction: both were deferred into the one shared batch.
        expect(parsed.midBody).toEqual([]);
        expect(parsed.afterBody).toEqual(['cjs', 'esm']);

        // The two copies really are a different module format (the ESM side reports itself
        // foreign once it finds the CJS side already claimed the slot), but they share the
        // one "react" install — so the report must carry the copy warning, never the React
        // clause, which would only be true for two genuinely different React installs.
        const contextMessage = parsed.messages.find((message: string) => message.includes('"CarburetorContext"'));

        expect(contextMessage).toContain('duplicated install, or the package loaded through two different module formats');
        expect(contextMessage).not.toContain('React modules');
    });
});

const MISSING_DIST_MESSAGE =
    'the compiled package is missing: run npm run build first, this regression needs both dist/cjs and dist/esm';

describe('sharedSingleton keeps getUid unique across a CJS/ESM split', () => {
    const name = 'a computed from each copy is settled after one transaction touches both stores';

    test(name, () => {
        const cjsEntry = path.join(CJS_ROOT, 'Carburetor', 'index.js');
        const esmEntry = path.join(ESM_ROOT, 'Carburetor', 'index.mjs');

        if (!existsSync(cjsEntry) || !existsSync(esmEntry)) {
            throw new Error(MISSING_DIST_MESSAGE);
        }

        const result = spawnSync(process.execPath, ['-e', LOST_SETTLEMENT_SCRIPT], {
            encoding: 'utf8',
            env: {...process.env, CJS_ROOT, ESM_ROOT},
        });

        if (result.error) {
            throw result.error;
        }

        expect(result.status, result.stderr).toEqual(0);

        const parsed = JSON.parse(result.stdout);

        expect(parsed.computedUidsCollide).toBeFalsy();
        expect(parsed.heardEsm).toEqual(1);
        expect(parsed.heardCjs).toEqual(1);
    });
});

describe('sharedSingleton keeps carburetorToken names unique across a CJS/ESM split', () => {
    const name = 'a name claimed by the CJS copy is reported, not thrown, when the ESM copy claims it too';

    test(name, () => {
        const cjsEntry = path.join(CJS_ROOT, 'Carburetor', 'index.js');
        const esmEntry = path.join(ESM_ROOT, 'Carburetor', 'index.mjs');

        if (!existsSync(cjsEntry) || !existsSync(esmEntry)) {
            throw new Error(MISSING_DIST_MESSAGE);
        }

        const result = spawnSync(process.execPath, ['-e', TOKEN_COLLISION_SCRIPT], {
            encoding: 'utf8',
            env: {...process.env, CJS_ROOT, ESM_ROOT},
        });

        if (result.error) {
            throw result.error;
        }

        expect(result.status, result.stderr).toEqual(0);

        const parsed = JSON.parse(result.stdout);

        expect(parsed.esmTokenId).toEqual('dual-format/shared-name');
        expect(parsed.messages.some((message: string) => message.includes('already exists'))).toBeTruthy();
    });
});

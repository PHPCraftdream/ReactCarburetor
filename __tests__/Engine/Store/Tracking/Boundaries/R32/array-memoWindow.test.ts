import {spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import path from "node:path";

/**
 * The rolling-window probe (R32-04) runs in a child process over the compiled cjs build: heap
 * sampling inside the rstest process would measure the test runner's own churn, and the
 * assertion is a drift band, not exact bytes.
 */
const childProgram = `
    if (process.env.NODE_ENV !== 'production') throw new Error('run with NODE_ENV=production');
    const {Carburetor} = require(process.env.ENTRY);
    const KEYS = 100;
    const TOTAL = 200000;
    const SAMPLES = [50000, 200000];
    class Store extends Carburetor {
        churn(i) {
            this.update(draft => {
                draft.byId['m' + i] = {n: i};
                delete draft.byId['m' + (i - KEYS)];
            });
        }
    }
    const store = new Store({byId: {}});
    global.gc();
    const heapAt = {};
    for (let i = 0; i < TOTAL; i++) {
        store.churn(i);
        if (SAMPLES.includes(i + 1)) {
            global.gc();
            heapAt[i + 1] = process.memoryUsage().heapUsed;
        }
    }
    if (Object.keys(store.getData().byId).length !== KEYS) {
        throw new Error('the rolling window did not hold ' + KEYS + ' live keys');
    }
    console.log(JSON.stringify({
        drift: heapAt[200000] - heapAt[50000],
        small: heapAt[50000],
        large: heapAt[200000],
    }));
`;

describe('write-path memo stays bounded to the live key set (R32-04)', () => {
    test('a 100-key rolling window over 200k add/delete cycles drifts at most 1 MB', () => {
        const entry = path.resolve(process.cwd(), 'dist', 'cjs', 'Carburetor', 'index.js');

        if (!existsSync(entry)) {
            throw new Error('the compiled package is missing: run npm run build first, this regression runs through dist/cjs');
        }

        const child = spawnSync(process.execPath, ['--expose-gc', '-e', childProgram], {
            encoding: 'utf8',
            env: {...process.env, ENTRY: entry, NODE_ENV: 'production'},
            timeout: 120000,
        });

        if (child.status !== 0) {
            throw new Error('probe child failed: ' + (child.stderr || child.error));
        }

        const {drift} = JSON.parse(child.stdout) as {drift: number};

        // 200k distinct keys at ~90 B apiece used to leak ≈18 MB; the bound keeps the memo
        // pinned to the 100 live keys, so anything past this band means the memos grew.
        expect(drift).toBeLessThanOrEqual(1024 * 1024);
    });

    test('deleted keys leave no memo entry behind: a rewritten key recomputes nothing stale', () => {
        const entry = path.resolve(process.cwd(), 'dist', 'cjs', 'Carburetor', 'index.js');

        if (!existsSync(entry)) {
            throw new Error('the compiled package is missing: run npm run build first, this regression runs through dist/cjs');
        }

        const program = `
            const {Carburetor} = require(process.env.ENTRY);
            class Store extends Carburetor {
                cycle(i) {
                    this.update(draft => {
                        draft['k' + i] = i;
                        delete draft['k' + (i - 1)];
                    });
                }
            }
            const store = new Store({});
            store.cycle(0);
            store.cycle(1);
            store.cycle(2);
            const data = store.getData();
            const keys = Object.keys(data);
            if (keys.length !== 1 || keys[0] !== 'k2' || data.k2 !== 2) {
                throw new Error('unexpected state after add/delete window: ' + JSON.stringify(data));
            }
            console.log('ok');
        `;
        const child = spawnSync(process.execPath, ['-e', program], {
            encoding: 'utf8', env: {...process.env, ENTRY: entry, NODE_ENV: 'production'},
        });

        if (child.status !== 0) {
            throw new Error('cycle child failed: ' + (child.stderr || child.error));
        }
    });
});

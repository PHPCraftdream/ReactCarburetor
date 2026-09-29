import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const dist = resolve(process.env.BENCH_DIST || 'dist');
const load = (path) => import(pathToFileURL(resolve(dist, path)).href);
const [{Carburetor}, {CarburetorHistory}] = await Promise.all([
    load('esm-prod/Carburetor/Store/Carburetor.mjs'),
    load('esm-prod/Carburetor/Tooling/CarburetorHistory.mjs'),
]);

const ROWS = 300;
const WRITES = 250;
const LIMIT = 50;
const ROUNDS = 9;

    class Board extends Carburetor {
        /** Updates a row title.
         *
         * @param index - row index
         * @param title - new title
         */
        setTitle(index, title) {
        this.update(draft => {
            draft.rows['row' + index].title = title;
        });
    }
}

const makeBoard = () => new Board({rows: Object.fromEntries(
    Array.from({length: ROWS}, (_, index) => ['row' + index, {title: 'initial', done: index % 2 === 0}])
)});

const samples = [];
for (let round = 0; round < ROUNDS; round++) {
    const board = makeBoard();
    const history = new CarburetorHistory(board, {limit: LIMIT});
    const started = performance.now();
    for (let i = 0; i < WRITES; i++) {
        board.setTitle(i % ROWS, 'updated-' + i);
    }
    samples.push((performance.now() - started) / WRITES);

    let undoDepth = 0;
    while (history.undo()) undoDepth++;
    if (undoDepth !== LIMIT || board.getData().rows.row0.title !== 'updated-0') {
        throw new Error('History limit or replay differs from the expected final state');
    }
    history.disconnect();
}

samples.sort((a, b) => a - b);
console.log(JSON.stringify({rows: ROWS, writesPerRound: WRITES, historyLimit: LIMIT,
    rounds: ROUNDS, medianMsPerWrite: samples[Math.floor(ROUNDS / 2)],
    minMsPerWrite: samples[0], maxMsPerWrite: samples[ROUNDS - 1]}));

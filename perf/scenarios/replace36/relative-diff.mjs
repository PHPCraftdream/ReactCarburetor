/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R36-05: replacements with a partial large diff retain leaf attribution beyond the absolute floor.
// Args: [rows=10000] [changed=2010]
import {emit, loadPath} from '../../harness/lib.mjs';

const {diffPaths} = await loadPath('Carburetor/Store/Paths/Diff/diffPaths.mjs');
const rows = Number(process.argv[2] ?? 10000);
const changed = Number(process.argv[3] ?? 2010);
const previous = {rows: Array.from({length: rows}, (_, id) => ({title: id})), unrelated: {value: 1}};
const next = {rows: Array.from({length: rows}, (_, id) => ({title: id < changed ? id + 1 : id})), unrelated: {value: 1}};
const start = performance.now();
const paths = diffPaths(previous, next);
const diffMs = performance.now() - start;
emit({
    diffMs, paths: paths.size, changed,
    precise: paths.has('rows.0.title') && paths.has(`rows.${changed - 1}.title`),
    noRoot: !paths.has('') && !paths.has('*'), unrelatedAsleep: !paths.has('unrelated'),
});

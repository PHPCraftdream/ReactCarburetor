/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {emit, loadPath} from '../../harness/lib.mjs';
const {diffPaths} = await loadPath('Carburetor/Store/Paths/Diff/diffPaths.mjs');
const previous = Array.from({length: 5000}, (_, title) => ({title}));
const partial = previous.map((row, i) => ({title: i < 2010 ? row.title + 1 : row.title}));
const total = previous.map(row => ({title: row.title + 1}));
const partialPaths = diffPaths(previous, partial, 'rows');
const totalPaths = diffPaths(previous, total, 'rows');
const shiftedNew = previous.slice(1).map(row => ({title: row.title}));
const shiftedPaths = diffPaths(previous, shiftedNew, 'rows');
emit({partialPaths: partialPaths.size, collapsedPaths: totalPaths.size, shiftedNewPaths: shiftedPaths.size,
    partialLeaf: partialPaths.has('rows.0.title') && partialPaths.has('rows.2009.title'),
    collapsed: totalPaths.has('rows'), shiftedNewCollapsed: shiftedPaths.has('rows'),
    valid: previous.every((row, i) => row.title === i) && partial[2009].title === 2010 && total[4999].title === 5000
        && shiftedNew[0].title === 1 && shiftedNew.length === 4999});

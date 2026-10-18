import {mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {distFreshState} from '../../../scripts/affected.mjs';

const TOUCH_NEW = path => utimesSync(path, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
const TOUCH_OLD = path => utimesSync(path, new Date(Date.now() - 5000), new Date(Date.now() - 5000));

describe('distFreshState', () => {
    let distRoot: string, sourcesRoot: string, source: string;
    const markers = () => [
        join(distRoot, 'esm', 'Carburetor', 'index.mjs'),
        join(distRoot, 'esm-prod', 'Carburetor', 'index.mjs'),
        join(distRoot, 'cjs', 'Carburetor', 'index.js')];
    beforeEach(() => {
        const base = mkdtempSync(join(tmpdir(), 'dist-fresh-'));
        distRoot = join(base, 'dist');
        sourcesRoot = join(base, 'src');
        mkdirSync(sourcesRoot, {recursive: true});
        source = join(sourcesRoot, 'x.ts');
        writeFileSync(source, 'export {};');
        for (const marker of markers()) {
            mkdirSync(dirname(marker), {recursive: true});
            writeFileSync(marker, '// marker\n');
            TOUCH_OLD(marker);
        }
    });
    afterEach(() => {
        rmSync(dirname(distRoot), {recursive: true, force: true});
        rmSync(sourcesRoot, {recursive: true, force: true});
    });

    it('is fresh when every dist marker is newer than the sources', () => {
        markers().forEach(TOUCH_NEW);
        expect(distFreshState(distRoot, sourcesRoot)).toEqual({fresh: true, problems: []});
    });

    it('reports only the stale formats', () => {
        TOUCH_NEW(markers()[1]);
        const state = distFreshState(distRoot, sourcesRoot);
        expect(state.fresh).toBe(false);
        expect(state.problems.some(problem => problem.includes('esm:'))).toBe(true);
        expect(state.problems.some(problem => problem.includes('cjs:'))).toBe(true);
        expect(state.problems.some(problem => problem.includes('esm-prod'))).toBe(false);
    });

    it('reports a missing marker', () => {
        rmSync(markers()[2]);
        const state = distFreshState(distRoot, sourcesRoot);
        expect(state.fresh).toBe(false);
        expect(state.problems.some(problem => problem.includes('missing'))).toBe(true);
    });
});

import {spawnSync} from 'node:child_process';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const script = join(root, 'perf', 'ci', 'contract', 'gateContract.mjs');

function status(file: string, expected: string, actual: string, amendment?: string) {
    const expression = `import {gateContractStatus} from ${JSON.stringify(pathToFileURL(script).href)};
console.log(JSON.stringify(gateContractStatus(${JSON.stringify(file)}, ${JSON.stringify(expected)},
${JSON.stringify(actual)}${amendment === undefined ? '' : ', ' + JSON.stringify(amendment)})));`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', expression], {encoding: 'utf8'});
    expect(child.status).toBe(0);
    expect(child.stderr).toBe('');
    return JSON.parse(child.stdout);
}

describe('gateContract.mjs gateContractStatus', () => {
    it('baseline hash passes', () => {
        expect(status('g.mjs', 'aaa', 'aaa', 'bbb')).toEqual({file: 'g.mjs', amended: false});
    });

    it('amended hash passes', () => {
        expect(status('g.mjs', 'aaa', 'bbb', 'bbb')).toEqual({file: 'g.mjs', amended: true});
    });

    it('foreign hash fails with distinct messages', () => {
        expect(status('g.mjs', 'aaa', 'zzz').error).toBe('Gate contract changed without amendment: g.mjs');
        expect(status('g.mjs', 'aaa', 'zzz', 'bbb').error).toBe('Amendment hash mismatch: g.mjs');
    });
});

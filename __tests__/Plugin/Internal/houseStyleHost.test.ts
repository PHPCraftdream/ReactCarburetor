import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import * as path from 'node:path';
import {generateHouseStyleOxlintJson} from '@plugin/Rules/Style/HouseStyle/house-style.oxlintrc.mts';

const ROOT = process.cwd();
const EXPECTED = {
    'max-line-length': 'error',
    'no-blank-line-after-tsdoc': 'error',
    'no-parent-import': 'error',
    'prefer-readonly-array-param': 'warn',
    'require-tsdoc': 'error',
    'tsdoc-blank-line-before-tags': 'error',
    'one-export-per-file': 'error',
};

describe('house-style host diagnostics', () => {
    test('reports all seven rules with their configured severities', () => {
        const temporary = mkdtempSync(path.join(ROOT, '.tmp-house-style-'));
        try {
            const config = path.join(temporary, 'house-style.oxlintrc.json');
            const pluginEntry = path.join(ROOT, 'plugin', 'src', 'index.mts');
            // no-parent-import stays silent until the config names the roots it may alias.
            const preset = JSON.parse(generateHouseStyleOxlintJson(pluginEntry)) as Record<string, unknown>;
            const roots = [{path: 'plugin/__fixtures__/style', prefix: '@fixtures/'}];
            const settings = {carburetor: {ruleOptions: {'no-parent-import': {roots}}}};
            writeFileSync(config, JSON.stringify({...preset, settings}));
            const fixtures = [
                'plugin/__fixtures__/style/maxLineLength.ts',
                'plugin/__fixtures__/style/noBlankLineAfterTsdoc.ts',
                'plugin/__fixtures__/style/sub/inner.ts',
                'plugin/__fixtures__/style/preferReadonlyArrayParam.ts',
                'plugin/__fixtures__/style/requireTsdoc.ts',
                'plugin/__fixtures__/style/tsdocBlankLineBeforeTags.ts',
                'plugin/__fixtures__/operations/oneExport.ts',
            ];
            const result = spawnSync(process.execPath, [
                path.join(ROOT, 'node_modules', 'oxlint', 'bin', 'oxlint'),
                '-c', config, '--format', 'agent', ...fixtures,
            ], {encoding: 'utf8', cwd: ROOT});
            const output = `${result.stdout || ''}${result.stderr || ''}`;
            expect(result.status).toBe(1);
            for (const [rule, severity] of Object.entries(EXPECTED)) {
                const label = severity === 'warn' ? 'warning' : severity;
                const name = rule;

                expect(output).toContain(`${label} carburetor(${name})`);
            }
        } finally {
            rmSync(temporary, {recursive: true, force: true});
        }
    });
});

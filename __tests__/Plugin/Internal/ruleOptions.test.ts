import {spawnSync} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {describe, expect, test} from "@rstest/core";
import {basesConfig} from "@plugin/Utils/NativeBases.mts";

const ROOT: string = process.cwd();
const ROOTS = [{path: 'lib/src', prefix: '@/'}];

/** Runs the real oxlint over files with one config, as a consumer would. */
const runOxlint = (config: string, files: readonly string[]): string => {
    const result = spawnSync(
        process.execPath,
        [path.join('node_modules', 'oxlint', 'bin', 'oxlint'), '-f', 'unix', '-c', config, ...files],
        {cwd: ROOT, encoding: 'utf8'},
    );

    return `${result.stdout || ''}${result.stderr || ''}`;
};

/** The generated config's rules section for a call in a fresh project. */
const generatedRules = (
    settings: Record<string, unknown> | undefined,
    forwarded: Record<string, Record<string, unknown>>,
): unknown => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-forwarded-'));

    try {
        const {config} = basesConfig(cwd, settings, forwarded);

        expect(existsSync(config)).toBe(true);

        return (JSON.parse(readFileSync(config, 'utf8')) as {rules?: unknown}).rules;
    } finally {
        rmSync(cwd, {recursive: true, force: true});
    }
};

describe('a rule\'s own options reach the native run', () => {
    test('options from the rule entry land in the config like settings.carburetor.ruleOptions do', () => {
        expect(generatedRules(undefined, {'no-parent-import': {roots: ROOTS}})).toEqual({
            'carburetor/no-parent-import': ['error', {roots: ROOTS}],
        });
    });

    test('the rule entry wins over settings for the same rule, and the other rules keep theirs', () => {
        const settings = {carburetor: {ruleOptions: {
            'no-parent-import': {roots: [{path: 'old', prefix: '~/'}]},
            'require-tsdoc': {requireParamDocs: true},
        }}};

        expect(generatedRules(settings, {'no-parent-import': {roots: ROOTS}})).toEqual({
            'carburetor/no-parent-import': ['error', {roots: ROOTS}],
            'carburetor/require-tsdoc': ['error', {requireParamDocs: true}],
        });
    });

    test('forwarded options keep the project rc\'s base lists when the host has no carburetor settings', () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-forwarded-rc-'));

        try {
            const rc = JSON.stringify({componentBases: ['AppComponent']});

            writeFileSync(path.join(cwd, '.carburetorrc.json'), rc);

            const {config} = basesConfig(cwd, undefined, {'max-render-depth': {max: 4}});

            expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual({
                componentBases: ['AppComponent'],
                storeBases: [],
                rules: {'carburetor/max-render-depth': ['error', {max: 4}]},
            });
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    test('no forwarded options leave the configuration key exactly as before', () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), 'carburetor-forwarded-none-'));

        try {
            expect(basesConfig(cwd, undefined, {})).toEqual(basesConfig(cwd, undefined));
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });
});

describe('no-parent-import through the real host', () => {
    const inner = path.join('plugin', '__fixtures__', 'style', 'sub', 'inner.ts');
    const fixture = (name: string): string => path.join('__tests__', 'Plugin', 'fixtures', name);

    test('roots given in the rule\'s own entry are applied', () => {
        const output = runOxlint(fixture('parentImportOwnOptions.oxlintrc.json'), [inner]);

        expect(output).toContain('carburetor(no-parent-import)');
    });

    test('switched on without roots, it says so once instead of staying silent', () => {
        const helper = path.join('plugin', '__fixtures__', 'style', 'helper.ts');
        const output = runOxlint(fixture('parentImportNoRoots.oxlintrc.json'), [inner, helper]);

        expect(output.split('names no roots').length - 1).toBe(1);
    });
});

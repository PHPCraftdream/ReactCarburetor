import {readFileSync} from "node:fs";
import plugin from "@plugin/index.mts";
import {RECOMMENDED} from "@plugin/recommended.mts";
import {NO_HOOKS} from "@plugin/noHooks.mts";
import {HOUSE_STYLE} from "@plugin/Rules/Style/HouseStyle/houseStyle.mts";
import {generateHouseStyleOxlintJson} from "@plugin/Rules/Style/HouseStyle/house-style.oxlintrc.mts";
import * as path from "node:path";
import config from "../../../rslib.config.ts";

const ROOT: string = process.cwd();
const PRESET = path.join(ROOT, 'plugin', 'recommended.oxlintrc.json');
const NO_HOOKS_PRESET = path.join(ROOT, 'plugin', 'src', 'no-hooks.oxlintrc.json');
const HOUSE_STYLE_PRESET = path.join(ROOT, 'plugin', 'src', 'Rules', 'Style', 'HouseStyle', 'house-style.oxlintrc.json');

const presetRules = (file: string): Record<string, string> => {
    return (JSON.parse(readFileSync(file, 'utf8')) as {rules: Record<string, string>}).rules;
};

describe('house-style preset contract', () => {
    test('validates rules and severities without changing recommended', () => {
        const rules = presetRules(HOUSE_STYLE_PRESET);
        expect(rules).toEqual({
            'carburetor/max-line-length': 'error',
            'carburetor/no-blank-line-after-tsdoc': 'error',
            'carburetor/no-parent-import': 'error',
            'carburetor/prefer-readonly-array-param': 'warn',
            'carburetor/require-tsdoc': 'error',
            'carburetor/tsdoc-blank-line-before-tags': 'error',
            'carburetor/one-export-per-file': 'error',
        });
        expect(rules).toEqual(HOUSE_STYLE);
        for (const [id, severity] of Object.entries(rules)) {
            expect(plugin.rules[id.replace('carburetor/', '')]).toBeDefined();
            expect(['error', 'warn', 'off']).toContain(severity);
        }
        expect(plugin.rules['one-export-per-file']).toBeDefined();
        expect(plugin.configs['house-style'].rules).toEqual(HOUSE_STYLE);
        expect(presetRules(PRESET)).toEqual(expect.objectContaining(RECOMMENDED));
        expect(presetRules(NO_HOOKS_PRESET)).toEqual(NO_HOOKS);
    });

    test('generated preset source matches shipped JSON and supports a custom plugin path', () => {
        expect(JSON.parse(generateHouseStyleOxlintJson())).toEqual(
            JSON.parse(readFileSync(HOUSE_STYLE_PRESET, 'utf8')),
        );
        expect(JSON.parse(generateHouseStyleOxlintJson('/absolute/index.mjs'))).toEqual({
            jsPlugins: ['/absolute/index.mjs'], rules: HOUSE_STYLE,
        });
    });

    test('rslib asset transform uses the shared preset generator', () => {
        const build = config as unknown as {
            lib: Array<{
                output?: {
                    distPath?: {root?: string};
                    copy?: Array<{to?: string; transform?: (input: Buffer) => string}>;
                };
            }>;
        };
        const lint = build.lib.find(({output}) => output?.distPath?.root === './dist/lint');
        const asset = lint?.output?.copy?.find(({to}) => to === './house-style.oxlintrc.json');
        expect(asset?.transform?.(Buffer.from('ignored'))).toBe(generateHouseStyleOxlintJson());
    });

    test('house-style package export targets the emitted asset', () => {
        const packageExports = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
            exports: Record<string, string>;
        };
        expect(packageExports.exports['./lint/house-style.oxlintrc.json']).toBe(
            './dist/lint/house-style.oxlintrc.json',
        );
    });
});

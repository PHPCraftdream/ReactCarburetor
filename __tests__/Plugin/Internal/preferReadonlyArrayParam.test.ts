import {readFileSync} from 'node:fs';

import {describe, expect, test} from '@rstest/core';
import plugin from '@plugin/index.mts';
import {RECOMMENDED} from '@plugin/recommended.mts';

describe('prefer-readonly-array-param plugin metadata', () => {
    test('is exported with a code-fix and is disabled in recommended', () => {
        expect(plugin.rules['prefer-readonly-array-param']).toBeDefined();
        expect(Object.keys(plugin.rules)).toHaveLength(37);
        expect(plugin.rules['prefer-readonly-array-param'].meta?.fixable).toBe('code');
        expect(RECOMMENDED['carburetor/prefer-readonly-array-param']).toBe('off');

        const config = JSON.parse(readFileSync('plugin/recommended.oxlintrc.json', 'utf8')) as {
            rules: Record<string, string>;
        };

        expect(config.rules['carburetor/prefer-readonly-array-param']).toBe('off');

        const nativeConfig = readFileSync('native/src/config/mod.rs', 'utf8');
        const severity = /\("prefer-readonly-array-param",\s*Severity::(\w+)\)/.exec(nativeConfig);

        expect(severity?.[1]).toBe('Off');
    });
});

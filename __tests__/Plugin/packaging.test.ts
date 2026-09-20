import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import plugin from "@plugin/index.mts";
import {RECOMMENDED} from "@plugin/recommended.mts";

/**
 * Guards the packaging, which is the part a consumer touches and the part no rule test covers.
 *
 * Two kinds of check. The drift guards keep the three places a rule name appears — the plugin, the
 * preset the ESLint config reads, and the JSON an oxlint config extends — from disagreeing. The host
 * checks run the *built* bundle the way a consumer would: through `extends` in oxlint and through a
 * flat config in ESLint. CI builds before it tests, so the bundle is there.
 */
const ROOT: string = process.cwd();
const CONSUMER: string = path.join('plugin', '__fixtures__', 'consumer');

const run = (binary: string, args: string[]): string => {
    try {
        return execFileSync(process.execPath, [binary, ...args], {encoding: 'utf8', cwd: ROOT});
    } catch (error) {
        const failure = error as {stdout?: string; stderr?: string};

        return `${failure.stdout || ''}${failure.stderr || ''}`;
    }
};

const readPreset = (): {jsPlugins: string[]; rules: Record<string, string>} => {
    const file = path.join(ROOT, 'plugin', 'recommended.oxlintrc.json');

    return JSON.parse(readFileSync(file, 'utf8')) as {jsPlugins: string[]; rules: Record<string, string>};
};

describe('packaging the lint rules', () => {
    test('the preset covers every rule the plugin ships, and nothing else', () => {
        const shipped = Object.keys(plugin.rules).map((name: string) => `carburetor/${name}`).sort();
        const preset = Object.keys(RECOMMENDED).sort();

        expect(preset).toEqual(shipped);
    });

    test('the oxlint preset matches the one the ESLint config reads', () => {
        const preset = readPreset();

        expect(preset.rules).toEqual(RECOMMENDED);
        // Resolved relative to the preset itself, which is what lets `extends` work from anywhere.
        expect(preset.jsPlugins).toEqual(['./index.mjs']);
    });

    test('the rule reference documents every rule', () => {
        const reference = readFileSync(path.join(ROOT, 'docs', 'rules.md'), 'utf8');
        const undocumented = Object.keys(plugin.rules).filter((name: string) => {
            return !reference.includes(`\`${name}\``);
        });

        expect(undocumented).toEqual([]);
    });

    test('the plugin exposes the preset as a flat config naming itself', () => {
        const recommended = plugin.configs?.recommended;

        expect(recommended?.plugins.carburetor).toBe(plugin);
        expect(recommended?.rules).toEqual(RECOMMENDED);
    });

    test('a consumer oxlint config gets the rules from one extends line', () => {
        const output = run(path.join('node_modules', 'oxlint', 'bin', 'oxlint'), [
            '-c', path.join(CONSUMER, 'oxlintrc.json'),
            path.join(CONSUMER, 'app.tsx'),
        ]);

        expect(output).toContain('carburetor(no-get-data-in-render)');
        // The preset's severities survive the trip: this one is a warning, not an error.
        expect(output).toMatch(/warning carburetor\(no-direct-data-write\)/);
    });

    test('the same built plugin works in an ESLint flat config', () => {
        const output = run(path.join('node_modules', 'eslint', 'bin', 'eslint.js'), [
            '--no-warn-ignored',
            '--format', 'json',
            '-c', path.join(CONSUMER, 'eslint.config.mjs'),
            path.join(CONSUMER, 'app.jsx'),
        ]);

        const results = JSON.parse(output) as {messages: {ruleId: string; severity: number}[]}[];
        const reported = results.flatMap(result => result.messages.map(message => message.ruleId)).sort();

        expect(reported).toEqual([
            'carburetor/no-get-data-in-render',
            'carburetor/no-lifecycle-class-property',
            'carburetor/require-super-in-lifecycle',
        ]);
    });
});

import {execFileSync} from "node:child_process";
import * as path from "node:path";

/**
 * Guards the packaging, which is the part a consumer touches and the part no rule test covers.
 *
 * Checks the built bundle through real consumer configs in Oxlint and ESLint.
 * Source-map/config-copy assertions are not substitutes for actual diagnostics.
 * CI builds before it tests, so the supplied bundle is available.
 */
const ROOT: string = process.cwd();
const CONSUMER: string = path.join('plugin', '__fixtures__', 'consumer');

const run = (binary: string, args: string[]): {status: number; output: string} => {
    try {
        const output = execFileSync(process.execPath, [binary, ...args], {encoding: 'utf8', cwd: ROOT});
        return {status: 0, output};
    } catch (error) {
        const failure = error as {status?: number; stdout?: string; stderr?: string};
        if (typeof failure.status !== 'number') throw error;
        return {status: failure.status, output: `${failure.stdout || ''}${failure.stderr || ''}`};
    }
};

describe('packaging the lint rules', () => {
    test('built plugin publishes H33 and H34 through the recommended preset', () => {
        const {output, status} = run(path.join('node_modules', 'oxlint', 'bin', 'oxlint'), [
            '-c', 'dist/lint/recommended.oxlintrc.json',
            '--format', 'agent',
            'examples/wrong/no-memo-over-store-read/MemoOverStoreRead.tsx',
            'examples/wrong/no-capturing-hook-selector/CapturingHookSelector.tsx',
        ]);
        expect(status).toBe(0);
        expect(output).toContain('carburetor(no-memo-over-store-read)');
        expect(output).toContain('carburetor(no-capturing-hook-selector)');
    });

    test('a consumer oxlint config gets the rules from one extends line', () => {
        // Explicit format: oxlint auto-switches to GitHub-annotation output under CI's own
        // GITHUB_ACTIONS env var, which this process inherits when the test itself runs in CI.
        // "agent" is the plain `path:line:col: severity rule: message` layout this assertion
        // expects — the same one oxlint picks on its own outside of a TTY and outside CI.
        const {output, status} = run(path.join('node_modules', 'oxlint', 'bin', 'oxlint'), [
            '-c', path.join(CONSUMER, 'oxlintrc.json'),
            '--format', 'agent',
            path.join(CONSUMER, 'app.tsx'),
        ]);
        expect(status).toBe(1);

        expect(output).toContain('carburetor(no-get-data-in-render)');
        // The preset's severities survive the trip: this one is a warning, not an error.
        expect(output).toMatch(/warning carburetor\(no-direct-data-write\)/);
    });

    test('the same built plugin works in an ESLint flat config', () => {
        const {output, status} = run(path.join('node_modules', 'eslint', 'bin', 'eslint.js'), [
            '--no-warn-ignored',
            '--format', 'json',
            '-c', path.join(CONSUMER, 'eslint.config.mjs'),
            path.join(CONSUMER, 'app.jsx'),
        ]);
        expect(status).toBe(1);

        const results = JSON.parse(output) as {messages: {ruleId: string; severity: number}[]}[];
        const reported = results.flatMap(result => result.messages.map(message => message.ruleId)).sort();

        expect(reported).toEqual([
            'carburetor/no-get-data-in-render',
            'carburetor/no-lifecycle-class-property',
            'carburetor/require-super-in-lifecycle',
        ]);
    });

    test('Oxlint keeps hooks allowed by default and rejects only React-owned calls when opted in', () => {
        const fixture = path.join(CONSUMER, 'noHooks.jsx');
        const host = path.join('node_modules', 'oxlint', 'bin', 'oxlint');
        const baseline = run(host, ['-c', 'dist/lint/recommended.oxlintrc.json', '--format', 'agent', fixture]);
        expect(baseline.status).toBe(0);
        expect(baseline.output).not.toContain('carburetor(no-react-hooks-in-components)');
        const enabled = run(host, ['-c', 'dist/lint/no-hooks.oxlintrc.json', '--format', 'agent', fixture]);
        expect(enabled.status).toBe(1);
        const locations = [...enabled.output.matchAll(
            /noHooks\.jsx:(\d+):(\d+): error carburetor\(no-react-hooks-in-components\)/g
        )].map(match => [Number(match[1]), Number(match[2])]);
        expect(locations).toEqual([[4, 21], [9, 5], [14, 16]]);
    });

    test('H31 reports when H29 and H30 are off in an ESLint flat config', () => {
        const {output, status} = run(path.join('node_modules', 'eslint', 'bin', 'eslint.js'), [
            '--no-warn-ignored',
            '--format', 'json',
            '-c', path.join(CONSUMER, 'overlaps', 'overlaps.config.mjs'),
            path.join(CONSUMER, 'overlaps', 'overlaps.component.jsx'),
        ]);
        // warnings alone do not fail ESLint, the message assertion below is what proves the report
        expect(status).toBe(0);

        const results = JSON.parse(output) as {messages: {ruleId: string; severity: number}[]}[];
        const messages = results.flatMap(result => result.messages.map(message =>
            [message.ruleId, message.severity]
        ));

        expect(messages).toEqual([
            ['carburetor/no-function-in-render', 1],
        ]);
    });

    test('ESLint consumes the supplied optional preset with aliases and shadowing intact', () => {
        const {output, status} = run(path.join('node_modules', 'eslint', 'bin', 'eslint.js'), [
            '--no-warn-ignored', '--format', 'json',
            '-c', path.join(CONSUMER, 'noHooks.config.mjs'),
            path.join(CONSUMER, 'noHooks.jsx'),
        ]);
        expect(status).toBe(1);
        const results = JSON.parse(output) as {
            messages: {ruleId: string; severity: number; line: number; column: number}[];
        }[];
        expect(results.flatMap(result => result.messages.map(message =>
            [message.ruleId, message.severity, message.line, message.column]
        ))).toEqual([
            ['carburetor/no-react-hooks-in-components', 2, 4, 21],
            ['carburetor/no-react-hooks-in-components', 2, 9, 5],
            ['carburetor/no-react-hooks-in-components', 2, 14, 16],
        ]);
    });
});

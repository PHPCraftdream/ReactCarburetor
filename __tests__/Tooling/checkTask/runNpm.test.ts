import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {execNpm, npmInvocation, quoteWindowsArgument} from '../../../scripts/tools/release/runNpm.mjs';

const ROOT = process.cwd();

describe('how npm is started', () => {
    test('outside Windows the arguments go to npm as they are, without a shell', () => {
        expect(npmInvocation(['view', '@react-carburetor/core', 'version'], 'linux'))
            .toEqual({command: 'npm', args: ['view', '@react-carburetor/core', 'version'], shell: false});
        expect(npmInvocation(['pack'], 'darwin').shell).toBe(false);
    });

    test('on Windows one quoted command line goes to the shell, with no argument array', () => {
        expect(npmInvocation(['trust', 'github', '@react-carburetor/core', '--repo', 'owner/name'], 'win32'))
            .toEqual({command: 'npm trust github @react-carburetor/core --repo owner/name', args: [], shell: true});
        expect(npmInvocation(['pack', 'C:\\Users\\A B\\x', ''], 'win32').command)
            .toBe('npm pack "C:\\Users\\A B\\x" ""');
    });

    test.each(['a%PATH%b', 'say "hi"', 'a^b', 'a!b', 'a\nb'])('refuses what the shell would expand: %j', value => {
        expect(() => quoteWindowsArgument(value)).toThrow(/Cannot pass/);
    });

    test('quotes only what needs it', () => {
        expect(quoteWindowsArgument('--access')).toBe('--access');
        expect(quoteWindowsArgument('a&b')).toBe('"a&b"');
        expect(quoteWindowsArgument('two words')).toBe('"two words"');
        expect(quoteWindowsArgument('')).toBe('""');
    });

    test('runs the real npm on this platform and reports its failure as a thrown status', () => {
        const version = String(execNpm(['--version'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']})).trim();

        expect(version).toMatch(/^\d+\.\d+\.\d+/);
        expect(() => execNpm(['definitely-not-an-npm-command'], {encoding: 'utf8', stdio: 'ignore'}))
            .toThrow(/exited with/);
    });

    test('no release script starts npm through a shell with an argument array any more', () => {
        const offenders: string[] = [];
        const walk = (directory: string): void => {
            for (const entry of readdirSync(path.join(ROOT, directory), {withFileTypes: true})) {
                const relative = path.posix.join(directory, entry.name);

                if (entry.isDirectory()) walk(relative);
                else if (entry.name.endsWith('.mjs') && /shell:\s*process\.platform/.test(
                    readFileSync(path.join(ROOT, relative), 'utf8'))) offenders.push(relative);
            }
        };

        walk('scripts/tools/release');
        walk('scripts/tools/buildInfo');

        expect(offenders).toEqual([]);
    });
});

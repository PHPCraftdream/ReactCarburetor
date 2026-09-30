import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
export const WORKDIR = path.join(REPO_ROOT, '.consumer-matrix');
export const FIXTURE = path.join(REPO_ROOT, 'scripts', 'consumer-fixture', 'consumer.tsx');
export const TSC_BIN = path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

/**
 * Two majors, the ones the peer range and CI's own "Library on React 18" job already pin:
 * 18.3.1 (newest of 18.x — the same point CI uses) and the 19.x this repo develops against.
 * `types` matches the major, since that is what a real consumer would install.
 */
export const REACT_VERSIONS = [
    {id: 'react18', react: '18.3.1', reactDom: '18.3.1', types: '18'},
    {id: 'react19', react: '19.3.0', reactDom: '19.3.0', types: '19'},
];

export const PACKAGE_MANAGERS = ['npm', 'pnpm'];
export const MODULE_FORMATS = ['esm', 'cjs'];

// Windows has no bare npm/pnpm/corepack executable, only the .cmd shim a shell resolves.
// `process.execPath` (an absolute path, sometimes with a space in it — "Program Files") must
// NOT go through a shell: shell mode does not quote the command itself, only its arguments.
const WINDOWS_SHELL_COMMANDS = new Set(['npm', 'pnpm', 'corepack']);

/**
 * Runs a command, capturing output instead of streaming it; never throws on a bad exit.
 *
 * @param command - the executable to run
 * @param args - arguments passed through to it, unescaped
 * @param options - forwarded to `spawnSync`; `cwd` is the common one callers set
 */
export const run = (command, args, options = {}) => {
    const shell = process.platform === 'win32' && WINDOWS_SHELL_COMMANDS.has(command);
    const result = spawnSync(command, args, {encoding: 'utf8', shell, ...options});

    return {
        ok: result.status === 0 && !result.error,
        status: result.status,
        stdout: result.stdout || '',
        stderr: result.stderr ? result.stderr : (result.error ? String(result.error) : ''),
    };
};

/** Whether pnpm can actually run here — via corepack first, then a directly installed pnpm. */
export const pnpmCommand = () => {
    if (run('corepack', ['pnpm', '--version']).ok) {
        return {command: 'corepack', prefix: ['pnpm']};
    }

    if (run('pnpm', ['--version']).ok) {
        return {command: 'pnpm', prefix: []};
    }

    return null;
};

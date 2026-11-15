import { spawnSync } from 'node:child_process';

/** Characters that cannot be quoted safely for the Windows command interpreter. */
const UNQUOTABLE = /["%^!\r\n]/;

/** Characters that make an argument need quotes on the Windows command line. */
const NEEDS_QUOTES = /[\s&|<>()]/;

/** Quotes one argument for the Windows command interpreter, which starts `npm.cmd`.
 *
 * @param value - one argument.
 * @returns {string} The argument as it is written on the command line.
 * @throws When the argument holds a character the interpreter would expand or cannot quote.
 */
export function quoteWindowsArgument(value) {
  const text = String(value);
  if (UNQUOTABLE.test(text)) throw new Error(`Cannot pass ${JSON.stringify(text)} to npm through a shell`);
  return text === '' || NEEDS_QUOTES.test(text) ? `"${text}"` : text;
}

/** Decides how to start npm on a platform.
 *
 * Elsewhere npm is a real executable and the arguments go to it as they are. On Windows it is a batch
 * file that Node refuses to start without a shell; `shell: true` with an argument array only
 * concatenates the arguments (Node warns about it, DEP0190), so the command line is built and quoted
 * here instead.
 *
 * @param args - npm arguments.
 * @param platform - `process.platform` unless a test says otherwise.
 * @returns {{command: string, args: string[], shell: boolean}} What to hand to `spawnSync`.
 */
export function npmInvocation(args, platform = process.platform) {
  if (platform !== 'win32') return { command: 'npm', args, shell: false };
  return { command: ['npm', ...args].map(quoteWindowsArgument).join(' '), args: [], shell: true };
}

/** Runs npm and returns the `spawnSync` result.
 *
 * @param args - npm arguments.
 * @param options - `spawnSync` options other than `shell`.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} The finished process, its output as strings.
 */
export function spawnNpm(args, options = {}) {
  const invocation = npmInvocation(args);
  return invocation.shell
    ? spawnSync(invocation.command, { ...options, shell: true })
    : spawnSync(invocation.command, invocation.args, options);
}

/** Runs npm like `execFileSync`: the standard output, or a thrown error for a failed or unstarted process.
 *
 * @param args - npm arguments.
 * @param options - `spawnSync` options other than `shell`.
 * @returns {string} What npm wrote to standard output, when it was piped (a string when `encoding` is given).
 * @throws When npm could not start or exited with a non-zero status.
 */
export function execNpm(args, options = {}) {
  const result = spawnNpm(args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const failure = new Error(`npm ${args.join(' ')} exited with ${result.status ?? result.signal}`);
    failure.status = result.status;
    throw failure;
  }
  return result.stdout;
}

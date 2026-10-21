import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluatePortability } from './evaluate.mjs';
import { inspectBinary } from './inspectBinary.mjs';

const USAGE = 'Usage: check.mjs --expect gnu|musl|windows|macos --arch x64|arm64 ' +
  '[--max-glibc 2.28] [--max-macos 11.0] <binary>';

/** Parses the command line.
 *
 * @param args - Arguments after the script name.
 * @returns {{file: string, policy: object}} The binary and the policy it must meet.
 */
function parseArguments(args) {
  const policy = { maxGlibc: '2.28', maxMacos: '11.0' };
  const keys = { '--expect': 'expect', '--arch': 'arch', '--max-glibc': 'maxGlibc', '--max-macos': 'maxMacos' };
  const files = [];
  for (let index = 0; index < args.length; index += 1) {
    if (keys[args[index]]) {
      if (index + 1 >= args.length) throw new Error(USAGE);
      policy[keys[args[index]]] = args[++index];
    } else if (args[index].startsWith('--')) throw new Error(USAGE);
    else files.push(args[index]);
  }
  if (files.length !== 1 || !['gnu', 'musl', 'windows', 'macos'].includes(policy.expect) ||
      !['x64', 'arm64'].includes(policy.arch)) throw new Error(USAGE);
  return { file: files[0], policy };
}

/** Verifies that a built binary links the way its platform package promises.
 *
 * @param args - Command-line arguments.
 * @returns {string[]} The violations, empty when the binary is portable as promised.
 */
export function checkPortability(args = process.argv.slice(2)) {
  const { file, policy } = parseArguments(args);
  const info = inspectBinary(readFileSync(file));
  console.log(`${file}: ${JSON.stringify(info)}`);
  const problems = evaluatePortability(info, policy);
  for (const problem of problems) console.error(`portability: ${problem}`);
  if (!problems.length) console.log(`portability: ok (${policy.expect}, ${policy.arch})`);
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (checkPortability().length) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

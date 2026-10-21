import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectShipped } from './collectShipped.mjs';
import { licenseFiles } from './licenseFiles.mjs';
import { renderThirdParty } from './renderThirdParty.mjs';

/** The cargo targets of the published platform packages; a test keeps this equal to the CI matrix. */
export const TARGETS = [
  'x86_64-pc-windows-msvc',
  'aarch64-pc-windows-msvc',
  'aarch64-apple-darwin',
  'x86_64-apple-darwin',
  'x86_64-unknown-linux-gnu',
  'x86_64-unknown-linux-musl',
  'aarch64-unknown-linux-musl',
  'aarch64-unknown-linux-gnu',
];

const OUTPUT = 'native/THIRD-PARTY-LICENSES.txt';

/** Normalizes a repository URL for matching: no `.git`, no trailing slash, lower case. */
const normalizeRepository = url => String(url || '').replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();

/** Loads the license texts kept here for crates whose published source ships none.
 *
 * @returns {Map<string, {source: string, text: string}>} Texts by normalized repository URL.
 */
function loadSupplements() {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const entries = JSON.parse(readFileSync(path.join(directory, 'supplements.json'), 'utf8'));
  return new Map(entries.map(entry => [normalizeRepository(entry.repository), {
    source: entry.source,
    text: readFileSync(path.join(directory, entry.file), 'utf8').replace(/\r\n?/g, '\n').trim(),
  }]));
}

/** Builds the attribution text from `cargo metadata` of every published target.
 *
 * @param root - Repository root.
 * @returns {string} The attribution file contents.
 * @throws When a linked crate has neither a license file nor a supplement.
 */
export function buildThirdParty(root = process.cwd()) {
  const supplements = loadSupplements();
  const crates = new Map();
  for (const target of TARGETS) {
    const json = execFileSync('cargo', [
      'metadata', '--format-version', '1', '--locked',
      '--manifest-path', path.join(root, 'native/Cargo.toml'), '--filter-platform', target,
    ], { encoding: 'utf8', maxBuffer: 1 << 28 });
    for (const crate of collectShipped(JSON.parse(json))) {
      let files = licenseFiles(crate.directory);
      const supplement = supplements.get(normalizeRepository(crate.repository));
      if (!files.length && supplement) files = [{ name: 'LICENSE', text: supplement.text, source: supplement.source }];
      crates.set(`${crate.name}@${crate.version}`, { ...crate, files });
    }
  }
  const missing = [...crates.values()].filter(crate => !crate.files.length)
    .map(crate => `${crate.name} ${crate.version}`);
  if (missing.length) {
    throw new Error(`No license text for: ${missing.join(', ')}. Add one to supplements.json ` +
      '(scripts/tools/release/attribution) with the upstream source.');
  }
  return renderThirdParty([...crates.values()]);
}

/** Writes or verifies the committed attribution file.
 *
 * @param args - `--write` regenerates the file; `--check` fails when it is out of date.
 * @param root - Repository root.
 * @returns {Promise<boolean>} Whether the committed file is current (always true after `--write`).
 */
export async function thirdParty(args = process.argv.slice(2), root = process.cwd()) {
  if (args.length !== 1 || !['--write', '--check'].includes(args[0])) {
    throw new Error('Usage: thirdParty.mjs --write | --check');
  }
  const file = path.join(root, OUTPUT);
  const expected = buildThirdParty(root);
  if (args[0] === '--write') {
    await writeFile(file, expected, 'utf8');
    console.log(`Wrote ${OUTPUT}`);
    return true;
  }
  const actual = (await readFile(file, 'utf8')).replace(/\r\n?/g, '\n');
  if (actual === expected) return true;
  console.error(`${OUTPUT} is out of date: run \`node scripts/tools/release/attribution/thirdParty.mjs --write\`.`);
  process.exitCode = 1;
  return false;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  thirdParty().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

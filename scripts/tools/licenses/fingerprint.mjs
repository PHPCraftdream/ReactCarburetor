import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sourceFiles = [
  'parseLicense.mjs', 'collectNpm.mjs', 'collectRust.mjs', 'evaluate.mjs',
  'fingerprint.mjs', 'check.mjs',
];

/** Recursively sorts object keys while preserving array order.
 *
 * @param {unknown} value - JSON-compatible value.
 * @returns {unknown} Canonical value.
 */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

/** Reads UTF-8 text and normalizes line endings.
 *
 * @param {string} file - Absolute file path.
 * @returns {Promise<string>} Normalized contents.
 */
async function readNormalized(file) {
  return (await readFile(file, 'utf8')).replace(/\r\n?/g, '\n');
}

/** Computes the canonical fingerprint for the selected repository.
 *
 * @param {string} root - Repository root.
 * @returns {Promise<string>} SHA-256 hexadecimal digest.
 */
export async function fingerprint(root = process.cwd()) {
  const hash = createHash('sha256');
  /** Adds a named value to the fingerprint hash.
   *
   * @param {string} name - Value label.
   * @param {string} content - Value content.
   */
  const add = (name, content) => hash.update(name).update('\0').update(content).update('\0');
  const packageJson = JSON.parse(await readNormalized(path.join(root, 'package.json')));
  const fields = [
    'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta',
  ];
  add('package-dependencies', JSON.stringify(canonicalize(Object.fromEntries(
    fields.filter(key => packageJson[key] !== undefined).map(key => [key, packageJson[key]]),
  ))));

  const lock = JSON.parse(await readNormalized(path.join(root, 'package-lock.json')));
  const { name: _name, version: _version, ...lockFields } = lock;
  const packages = Object.entries(lock.packages || {}).map(([name, metadata]) => {
    const value = { ...metadata };
    if (name === '') {
      for (const key of ['name', 'version', 'scripts', 'description']) delete value[key];
    }
    return [name, canonicalize(value)];
  }).sort(([a], [b]) => a.localeCompare(b));
  add('package-lock', JSON.stringify(canonicalize({ ...lockFields, packages })));
  add('Cargo.lock', await readNormalized(path.join(root, 'native/Cargo.lock')));
  add('Cargo.toml', await readNormalized(path.join(root, 'native/Cargo.toml')));

  const policy = JSON.parse(await readNormalized(path.join(root, 'scripts/tools/licenses/policy.json')));
  add('policy', JSON.stringify(canonicalize(policy)));
  const base = path.join(root, 'scripts/tools/licenses');
  for (const file of sourceFiles) add(file, await readNormalized(path.join(base, file)));
  const workflow = path.join(root, '.github/workflows/licenses.yml');
  try {
    add('licenses-workflow', await readNormalized(workflow));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return hash.digest('hex');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  fingerprint().then(value => console.log(value));
}

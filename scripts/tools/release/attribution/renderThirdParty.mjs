import { createHash } from 'node:crypto';

const RULE = '='.repeat(72);

/** The runtime the musl packages link statically; not a crate, so it is stated here. */
const MUSL_NOTICE = [
  'musl libc (the carburetor-lint-linux-*-musl packages only)',
  '-'.repeat(57),
  'The musl binaries link musl libc statically. musl is distributed under the MIT license:',
  'https://git.musl-libc.org/cgit/musl/tree/COPYRIGHT',
  '',
  'Copyright (c) 2005-2020 Rich Felker, et al.',
  '',
  'Permission is hereby granted, free of charge, to any person obtaining',
  'a copy of this software and associated documentation files (the',
  '"Software"), to deal in the Software without restriction, including',
  'without limitation the rights to use, copy, modify, merge, publish,',
  'distribute, sublicense, and/or sell copies of the Software, and to',
  'permit persons to whom the Software is furnished to do so, subject to',
  'the following conditions:',
  '',
  'The above copyright notice and this permission notice shall be',
  'included in all copies or substantial portions of the Software.',
  '',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,',
  'EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF',
  'MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.',
  'IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY',
  'CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,',
  'TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE',
  'SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
].join('\n');

/** Orders crates by name, then version.
 *
 * @param a - First crate.
 * @param b - Second crate.
 * @returns {number} Sort order.
 */
const byCrate = (a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name));

/** Renders the third-party attribution file for the linked crates.
 *
 * Identical license texts are printed once and name every crate that carries them, so the file
 * stays readable and its size follows the number of distinct texts, not of crates.
 *
 * @param crates - Linked crates with `name`, `version`, `license`, `repository` and `files`
 * (`{name, text, source?}`: read from the crate's source directory, or a supplement with its `source` URL).
 * @returns {string} The file contents, newline-terminated, independent of input order.
 */
export function renderThirdParty(crates) {
  const sorted = [...crates].sort(byCrate);
  const texts = new Map();
  for (const crate of sorted) {
    const label = `${crate.name} ${crate.version}`;
    for (const file of crate.files) {
      const key = createHash('sha256').update(file.text).digest('hex');
      const entry = texts.get(key) || { text: file.text, source: file.source, users: [] };
      if (!entry.users.includes(label)) entry.users.push(label);
      texts.set(key, entry);
    }
  }
  const ordered = [...texts.values()].sort((a, b) =>
    a.users[0].localeCompare(b.users[0]) || a.text.localeCompare(b.text));
  const lines = [
    'THIRD-PARTY LICENSES',
    RULE,
    '',
    'The carburetor-lint binaries in the carburetor-lint-<platform> packages statically include the',
    'components below. Each is used under the terms of its own license; the texts follow the list.',
    'The Rust standard library, also linked in, is available under MIT OR Apache-2.0.',
    '',
    'Generated from native/Cargo.lock by scripts/tools/release/attribution/thirdParty.mjs.',
    'Do not edit by hand: run `node scripts/tools/release/attribution/thirdParty.mjs --write`.',
    '',
    `Rust crates (${sorted.length})`,
    '-'.repeat(24),
  ];
  for (const crate of sorted) {
    const repository = crate.repository ? ` - ${crate.repository}` : '';
    lines.push(`${crate.name} ${crate.version} - ${crate.license}${repository}`);
  }
  lines.push('', MUSL_NOTICE, '', 'License texts', '-------------');
  ordered.forEach((entry, index) => {
    lines.push('', `[${index + 1}] ${entry.users.join(', ')}`);
    if (entry.source) lines.push(`(the published crates ship no license file; text from ${entry.source})`);
    lines.push('', entry.text);
  });
  return `${lines.join('\n')}\n`;
}

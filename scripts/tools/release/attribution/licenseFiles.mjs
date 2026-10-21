import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const LICENSE_FILE = /^(licen[sc]e|copying|notice|unlicense)([-_.].*)?$/i;

/** Reads the license and notice files that sit at the top of a crate's source directory.
 *
 * @param directory - The crate's source directory.
 * @returns {Array<{name: string, text: string}>} Files sorted by code point (locale-independent),
 * line endings normalized.
 */
export function licenseFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && LICENSE_FILE.test(entry.name))
    .map(entry => ({
      name: entry.name,
      text: readFileSync(path.join(directory, entry.name), 'utf8').replace(/\r\n?/g, '\n').trim(),
    }))
    .filter(file => file.text.length > 0)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

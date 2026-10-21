import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const BLOCK = 512;

/** Reads a NUL-terminated field of a tar header.
 *
 * @param header - The 512-byte header block.
 * @param start - Field offset.
 * @param length - Field length.
 * @returns {string} The text before the first NUL.
 */
function field(header, start, length) {
  const bytes = header.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? length : end).toString('utf8');
}

/** Reads the `path` record of a pax extended header.
 *
 * @param body - The extended header's contents.
 * @returns {string|undefined} The path it overrides, if any.
 */
function paxPath(body) {
  const text = body.toString('utf8');
  const match = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(text);
  return match ? match[1] : undefined;
}

/** Unpacks an npm tarball the way npm does: without the leading `package/` directory, keeping
 * each file's mode, so a binary's execute bit survives.
 *
 * Plain Node on purpose. A `tar` on the PATH differs by platform (GNU tar reads `C:\\x` as a
 * remote host), and this must give the same answer on every runner.
 *
 * @param tarball - The `.tgz` file.
 * @param destination - Directory to create and fill.
 * @returns {Promise<string[]>} The relative paths written.
 */
export async function extractTarball(tarball, destination) {
  const data = gunzipSync(await readFile(tarball));
  const written = [];
  let longName;
  for (let offset = 0; offset + BLOCK <= data.length;) {
    const header = data.subarray(offset, offset + BLOCK);
    if (header.every(byte => byte === 0)) break;
    const size = parseInt(field(header, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const body = data.subarray(offset + BLOCK, offset + BLOCK + size);
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'L') {
      longName = field(body, 0, body.length);
    } else if (type === 'x') {
      longName = paxPath(body) ?? longName;
    } else if (type === '0') {
      const prefix = field(header, 345, 155);
      const name = longName ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
      longName = undefined;
      const relative = name.split('/').slice(1).join('/');
      if (!relative || relative.split('/').includes('..')) throw new Error(`Unsafe path in tarball: ${name}`);
      const target = path.join(destination, ...relative.split('/'));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, body);
      chmodSync(target, parseInt(field(header, 100, 8).trim() || '644', 8) & 0o777);
      written.push(relative);
    }
  }
  return written;
}

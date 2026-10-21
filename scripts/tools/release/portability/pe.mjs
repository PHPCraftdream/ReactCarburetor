const MACHINES = { 0x8664: 'x64', 0xaa64: 'arm64' };
const IMPORT_TABLE = 1;
const DELAY_IMPORT_TABLE = 13;

/** Reads a NUL-terminated ASCII string at a file offset.
 *
 * @param bytes - The file contents.
 * @param offset - Start of the string.
 * @returns {string} The string, without its terminator.
 */
function cString(bytes, offset) {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  return Buffer.from(bytes.subarray(offset, end)).toString('latin1');
}

/** Lists the DLLs a PE32+ executable imports, directly or by delay load.
 *
 * @param bytes - The whole executable.
 * @returns {{arch: string, imports: string[]}} The machine and the lower-cased DLL names.
 * @throws When the file is not a PE32+ executable.
 */
export function parsePe(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 64 || view.getUint16(0, true) !== 0x5a4d) throw new Error('Not a PE file');
  const pe = view.getUint32(0x3c, true);
  if (view.getUint32(pe, true) !== 0x00004550) throw new Error('Not a PE file');
  const machine = view.getUint16(pe + 4, true);
  const sectionCount = view.getUint16(pe + 6, true);
  const optionalSize = view.getUint16(pe + 20, true);
  const optional = pe + 24;
  if (view.getUint16(optional, true) !== 0x20b) throw new Error('Only PE32+ executables are supported');
  const directories = optional + 112;

  const sections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const header = optional + optionalSize + index * 40;
    sections.push({
      size: Math.max(view.getUint32(header + 8, true), view.getUint32(header + 16, true)),
      address: view.getUint32(header + 12, true),
      pointer: view.getUint32(header + 20, true),
    });
  }
  /** Maps a relative virtual address to a file offset. */
  const offsetOf = rva => {
    const section = sections.find(item => rva >= item.address && rva < item.address + item.size);
    if (!section) throw new Error(`RVA 0x${rva.toString(16)} is outside every section`);
    return section.pointer + (rva - section.address);
  };

  const imports = new Set();
  for (const [index, stride, nameField] of [[IMPORT_TABLE, 20, 12], [DELAY_IMPORT_TABLE, 32, 4]]) {
    const rva = view.getUint32(directories + index * 8, true);
    if (!rva) continue;
    for (let entry = offsetOf(rva); ; entry += stride) {
      const name = view.getUint32(entry + nameField, true);
      if (!name) break;
      imports.add(cString(bytes, offsetOf(name)).toLowerCase());
    }
  }
  return { arch: MACHINES[machine] ?? `machine-${machine}`, imports: [...imports].sort((a, b) => a.localeCompare(b)) };
}

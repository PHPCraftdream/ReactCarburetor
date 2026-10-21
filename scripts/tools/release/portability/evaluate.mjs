/** Libraries every glibc distribution provides; anything else a gnu binary needs is a defect. */
const GLIBC_BASE_LIBRARIES = new RegExp(`^(${[
  /libc\.so\.6/, /libm\.so\.6/, /libdl\.so\.2/, /libpthread\.so\.0/, /librt\.so\.1/,
  /libutil\.so\.1/, /libgcc_s\.so\.1/, /ld-linux[\w.-]*\.so\.\d+/,
].map(pattern => pattern.source).join('|')})$`);

/** Windows runtimes that a self-contained build must not import. */
const WINDOWS_RUNTIME = /^(vcruntime|msvcp|concrt|vccorlib|ucrtbase)|^api-ms-win-crt-/;

/** Dylibs a macOS binary may link: the OS's own, never a package manager's. */
const MACOS_SYSTEM = /^(\/usr\/lib\/|\/System\/Library\/)/;

/** Compares dotted versions numerically.
 *
 * @param a - First version.
 * @param b - Second version.
 * @returns {number} Negative, zero or positive like a comparator.
 */
export function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

/** Checks a binary's linking facts against what its platform package promises.
 *
 * @param info - Parsed binary: `{format, arch, ...}` from `inspectBinary`.
 * @param policy - `{expect: 'gnu'|'musl'|'windows'|'macos', arch, maxGlibc?, maxMacos?}`.
 * @returns {string[]} Violations; empty when the binary is portable as promised.
 */
export function evaluatePortability(info, policy) {
  const problems = [];
  const formats = { gnu: 'elf', musl: 'elf', windows: 'pe', macos: 'macho' };
  if (info.format !== formats[policy.expect]) {
    return [`expected ${formats[policy.expect]} format for ${policy.expect}, found ${info.format}`];
  }
  if (info.arch !== policy.arch) problems.push(`built for ${info.arch}, expected ${policy.arch}`);

  if (policy.expect === 'musl') {
    if (info.interpreter) problems.push(`has a dynamic loader (${info.interpreter}); a musl build must be static`);
    if (info.needed.length) problems.push(`needs shared libraries: ${info.needed.join(', ')}`);
  }

  if (policy.expect === 'gnu') {
    if (!info.interpreter) problems.push('has no dynamic loader; a gnu build is dynamically linked');
    for (const library of info.needed.filter(name => !GLIBC_BASE_LIBRARIES.test(name))) {
      problems.push(`needs ${library}, which not every glibc system provides`);
    }
    const glibc = info.versions.filter(item => /^GLIBC_\d/.test(item.name))
      .map(item => item.name.slice('GLIBC_'.length));
    const newest = glibc.sort(compareVersions).at(-1);
    if (newest && compareVersions(newest, policy.maxGlibc) > 0) {
      problems.push(`needs GLIBC_${newest}; the floor is GLIBC_${policy.maxGlibc}`);
    }
    for (const item of info.versions.filter(entry => /^(GLIBCXX|CXXABI)_/.test(entry.name))) {
      problems.push(`needs ${item.name} from ${item.file}: the binary must not depend on libstdc++`);
    }
  }

  if (policy.expect === 'windows') {
    for (const library of info.imports.filter(name => WINDOWS_RUNTIME.test(name))) {
      problems.push(`imports ${library}: link the C runtime statically (+crt-static)`);
    }
  }

  if (policy.expect === 'macos') {
    for (const dylib of info.dylibs.filter(name => !MACOS_SYSTEM.test(name))) {
      problems.push(`links ${dylib}, which is not part of macOS`);
    }
    if (!info.minos) problems.push('declares no minimum macOS version');
    else if (compareVersions(info.minos, policy.maxMacos) > 0) {
      problems.push(`requires macOS ${info.minos}; the floor is ${policy.maxMacos}`);
    }
  }
  return problems;
}

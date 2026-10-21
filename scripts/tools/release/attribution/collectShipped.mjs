import path from 'node:path';

/** Whether a package is a procedural macro: it runs while compiling and is never linked. */
const isProcMacro = pkg => pkg.targets?.some(target => target.kind?.includes('proc-macro'));

/** Collects the crates statically linked into the binary that `cargo metadata` describes.
 *
 * The closure follows normal dependencies only, from the workspace members. Build scripts and
 * procedural macros run at compile time and are not part of the distributed binary.
 *
 * @param metadata - Cargo metadata JSON for one `--filter-platform` target.
 * @returns {Array<object>} Linked crates, excluding workspace members, sorted by name and version.
 */
export function collectShipped(metadata) {
  if (!Array.isArray(metadata?.packages) || !Array.isArray(metadata?.workspace_members) ||
      !Array.isArray(metadata?.resolve?.nodes)) throw new Error('Invalid Cargo metadata');
  const packages = new Map(metadata.packages.map(pkg => [pkg.id, pkg]));
  const nodes = new Map(metadata.resolve.nodes.map(node => [node.id, node]));
  const roots = new Set(metadata.workspace_members);
  if (!roots.size) throw new Error('Cargo metadata has no workspace members');
  const reached = new Set();
  const queue = [...roots];
  while (queue.length) {
    const id = queue.shift();
    if (reached.has(id)) continue;
    const node = nodes.get(id);
    if (!packages.has(id) || !node) throw new Error(`Cargo metadata is missing ${id}`);
    reached.add(id);
    for (const dependency of node.deps || []) {
      const linked = (dependency.dep_kinds || []).some(item => item.kind === null || item.kind === 'normal');
      const target = packages.get(dependency.pkg);
      if (!target) throw new Error(`Cargo metadata is missing ${dependency.pkg}`);
      if (linked && !isProcMacro(target)) queue.push(dependency.pkg);
    }
  }
  return [...reached].filter(id => !roots.has(id)).map(id => {
    const pkg = packages.get(id);
    return {
      name: pkg.name,
      version: pkg.version,
      license: pkg.license || 'UNKNOWN',
      repository: pkg.repository || null,
      directory: path.dirname(pkg.manifest_path),
    };
  }).sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)));
}

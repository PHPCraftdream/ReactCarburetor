/** Collect Cargo packages reachable from validated workspace members.
 *
 * @param metadata - Cargo metadata JSON.
 * @returns {Array<object>} Reachable dependency records, excluding workspace roots.
 */
export function collectRust(metadata) {
  if (!Array.isArray(metadata?.packages) || !Array.isArray(metadata?.workspace_members) ||
      !Array.isArray(metadata?.resolve?.nodes)) throw new Error('Invalid Cargo metadata');
  const packages = new Map(metadata.packages.map(pkg => [pkg.id, pkg]));
  const nodes = new Map(metadata.resolve.nodes.map(node => [node.id, node]));
  const roots = new Set(metadata.workspace_members);
  if (!roots.size) throw new Error('Cargo metadata has no workspace members');
  for (const id of roots) {
    if (!packages.has(id) || !nodes.has(id)) throw new Error(`Missing workspace metadata for ${id}`);
  }
  const reached = new Map();
  const queue = [...roots].map(id => ({ id, scope: 'shipped', parent: null, kinds: [] }));
  while (queue.length) {
    const current = queue.shift();
    if (!packages.has(current.id) || !nodes.has(current.id)) {
      throw new Error(`Cargo metadata dependency missing node or package ${current.id}`);
    }
    const previous = reached.get(current.id);
    if (!previous || (previous.scope === 'dev' && current.scope === 'shipped')) {
      reached.set(current.id, { scope: current.scope, incoming: previous?.incoming || [] });
    }
    const record = reached.get(current.id);
    const parentPkg = current.parent ? packages.get(current.parent) : null;
    const parentPath = parentPkg ? `${parentPkg.name}@${parentPkg.version}` : null;
    if (parentPath && !record.incoming.some(edge => edge.parent === parentPath &&
        JSON.stringify(edge.kinds) === JSON.stringify(current.kinds))) {
      record.incoming.push({ parent: parentPath, kinds: current.kinds });
    }
    if (previous?.scope === 'shipped' || (previous?.scope === 'dev' && current.scope === 'dev')) continue;
    for (const dependency of nodes.get(current.id).deps || []) {
      if (!packages.has(dependency.pkg) || !nodes.has(dependency.pkg)) {
        throw new Error(`Cargo metadata dependency missing node or package ${dependency.pkg}`);
      }
      const kinds = dependency.dep_kinds?.map(item => item.kind) ?? [];
      if (!kinds.length || kinds.some(kind => ![null, 'normal', 'build', 'dev'].includes(kind))) {
        throw new Error(`Invalid dependency kind for ${dependency.pkg}`);
      }
      const scope = current.scope === 'shipped' && kinds.some(kind => kind === null || kind === 'normal')
        ? 'shipped' : 'dev';
      queue.push({ id: dependency.pkg, scope, parent: current.id, kinds });
    }
  }
  return [...reached].filter(([id]) => !roots.has(id)).map(([id, detail]) => {
    const pkg = packages.get(id);
    return {
      ecosystem: 'cargo', name: pkg.name, version: pkg.version,
      license: pkg.license || 'UNKNOWN', scope: detail.scope,
      path: `${pkg.name}@${pkg.version}`,
      missingLicense: !pkg.license,
      incoming: detail.incoming,
    };
  });
}

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Lists the platform packages installed in a project.
 *
 * @param modules - The project's `node_modules` directory.
 * @returns {string[]} Sorted names such as `@react-carburetor/lint-linux-x64-gnu`; the launcher
 * `@react-carburetor/lint` is not a platform package.
 */
export function installedPlatforms(modules) {
  const scope = path.join(modules, '@react-carburetor');
  if (!existsSync(scope)) return [];
  return readdirSync(scope).filter(name => name.startsWith('lint-')).map(name => `@react-carburetor/${name}`).sort();
}

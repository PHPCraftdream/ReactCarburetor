import { execFileSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectNpm } from './collectNpm.mjs';
import { collectRust } from './collectRust.mjs';
import { evaluate } from './evaluate.mjs';
import { fingerprint } from './fingerprint.mjs';

/** Escapes untrusted text for a Markdown table cell or inline code span.
 *
 * @param {unknown} value - Text to render.
 * @returns {string} Safe Markdown text.
 */
function escapeMarkdown(value) {
  return String(value ?? '').replace(/[\\`|\[\]<>]/g, '\\$&').replace(/[\r\n]+/g, ' ');
}

/** Builds the human-readable license report.
 *
 * @param {object} result - Evaluation result.
 * @param {string} digest - Dependency fingerprint.
 * @returns {string} Markdown report.
 */
function renderReport(result, digest) {
  const lines = [
    '## Dependency license report',
    `Fingerprint: \`${escapeMarkdown(digest)}\``,
    '',
    '| Ecosystem | Scope | License | Count |',
    '|---|---|---|---:|',
  ];
  for (const [key, count] of Object.entries(result.summary).sort()) {
    const [ecosystem, scope, ...licenseParts] = key.split(':');
    const license = licenseParts.join(':');
    lines.push(`| ${escapeMarkdown(ecosystem)} | ${escapeMarkdown(scope)} | `
      + `${escapeMarkdown(license)} | ${count} |`);
  }
  for (const [title, items] of [['Review', result.review], ['Violations', result.violations]]) {
    lines.push('', `### ${title} (${items.length})`);
    for (const item of items) {
      const incoming = item.incoming?.map(edge =>
        `${edge.parent} (${edge.kinds.join(', ')})`).join('; ');
      const itemPath = incoming ? `${item.path}; pulled by ${incoming}` : item.path;
      lines.push(`- ${escapeMarkdown(item.name)}@${escapeMarkdown(item.version)} — `
        + `${escapeMarkdown(item.license)} — \`${escapeMarkdown(itemPath)}\``);
    }
    if (!items.length) lines.push('- None');
  }
  lines.push('', `### Stale exceptions (${result.stale.length})`);
  for (const item of result.stale) {
    lines.push(`- ${escapeMarkdown(item?.ecosystem)}:${escapeMarkdown(item?.name)}@`
      + `${escapeMarkdown(item?.version)} — ${escapeMarkdown(item?.license)} — `
      + `${escapeMarkdown(item?.reason)}`);
  }
  if (!result.stale.length) lines.push('- None');
  return lines.join('\n');
}

/** Checks dependency license policy, optionally using offline metadata fixtures.
 *
 * @param {string[]} args - Supported CLI arguments.
 * @param {string} root - Repository root.
 * @returns {Promise<object>} Evaluation result.
 */
export async function check(args = process.argv.slice(2), root = process.cwd()) {
  let metadataFile;
  let npmOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--metadata') {
      if (metadataFile || !args[index + 1] || args[index + 1].startsWith('--')) {
        throw new Error('--metadata requires exactly one metadata file operand');
      }
      metadataFile = args[++index];
    } else if (args[index] === '--npm-only') npmOnly = true;
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (metadataFile && npmOnly) throw new Error('--metadata cannot be combined with --npm-only');
  const policy = JSON.parse(await readFile(path.join(root, 'scripts/tools/licenses/policy.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const records = collectNpm(lock);
  if (metadataFile) {
    const metadataPath = path.resolve(root, metadataFile);
    records.push(...collectRust(JSON.parse(await readFile(metadataPath, 'utf8'))));
  } else if (!npmOnly) {
    if (process.env.CI !== 'true') {
      throw new Error('Full license check requires CI=true or --metadata; use --npm-only locally');
    }
    const cargoArgs = ['metadata', '--format-version', '1', '--locked', '--manifest-path',
      path.join(root, 'native/Cargo.toml')];
    const metadata = execFileSync('cargo', cargoArgs, { encoding: 'utf8' });
    records.push(...collectRust(JSON.parse(metadata)));
  }
  const result = evaluate(records, policy, { ecosystems: npmOnly ? ['npm'] : undefined });
  const digest = await fingerprint(root);
  const report = renderReport(result, digest);
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${report}\n`, 'utf8');
  }
  if (!result.ok) process.exitCode = 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  check().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

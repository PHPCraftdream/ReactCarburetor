import { describe, expect, it } from '@rstest/core';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { collectNpm } from '../../../scripts/tools/licenses/collectNpm.mjs';
import { evaluate } from '../../../scripts/tools/licenses/evaluate.mjs';

const root = process.cwd();

describe('offline npm license check', () => {
  it('evaluates the committed lockfile quickly without invoking Cargo', async () => {
    const started = performance.now();
    const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
    const policy = JSON.parse(await readFile(path.join(root, 'scripts/tools/licenses/policy.json'), 'utf8'));
    const records = collectNpm(lock);
    const result = evaluate(records, policy, { ecosystems: ['npm'] });
    const elapsed = performance.now() - started;

    expect(records.length).toBeGreaterThan(0);
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(elapsed).toBeLessThan(2000);
  });
});

import { describe, expect, it } from '@rstest/core';
import { parseLicense } from '../../../scripts/tools/licenses/parseLicense.mjs';
import policy from '../../../scripts/tools/licenses/policy.json' with { type: 'json' };

describe('license parser', () => {
  it('accepts an allowed OR alternative and applies AND precedence', () => {
    expect(parseLicense('MIT OR GPL-3.0-only', policy)).toBe('allowed');
    expect(parseLicense('MIT AND GPL-3.0-only', policy, 'dev')).toBe('review');
    expect(parseLicense('MIT OR GPL-3.0-only AND UNKNOWN', policy)).toBe('allowed');
  });
  it('requires complete valid input and reports unknown identifiers', () => {
    expect(parseLicense('Mystery-license', policy)).toBe('unknown');
    expect(parseLicense('MIT!!!', policy)).toBe('unknown');
    expect(parseLicense('MIT garbage', policy)).toBe('unknown');
  });
  it('handles case-insensitive identifiers, operators, and conservative WITH exceptions', () => {
    expect(parseLicense('mit OR gpl-3.0-only', policy)).toBe('allowed');
    expect(parseLicense('GPL-3.0-only WITH Classpath-exception-2.0', policy)).toBe('denied');
    expect(parseLicense('MIT WITH LLVM-exception', policy)).toBe('review');
    expect(parseLicense('Mystery WITH LLVM-exception', policy)).toBe('unknown');
  });
  it('handles grouping, slash alternatives, plus suffixes, and LicenseRef values', () => {
    expect(parseLicense('(GPL-3.0-only OR MIT) AND BSD-3-Clause', policy)).toBe('allowed');
    expect(parseLicense('GPL-3.0-only / MIT', policy)).toBe('allowed');
    expect(parseLicense('MIT+', policy)).toBe('allowed');
    expect(parseLicense('LicenseRef-private', policy)).toBe('unknown');
  });
  it('returns unknown for empty expressions and malformed operators', () => {
    for (const expression of [
      '', '   ', 'MIT AND', 'OR MIT', 'MIT OR OR BSD-3-Clause', '()',
      'MIT OR AND', 'MIT OR (OR)', 'MIT OR WITH', 'MIT WITH AND', 'MIT OR (MIT AND OR)',
    ]) {
      expect(parseLicense(expression, policy)).toBe('unknown');
    }
  });
});

import { parseLicense } from './parseLicense.mjs';

/**
 * Evaluates dependency records against license policy and exact exceptions.
 *
 * @param records - Dependency records to classify.
 * @param policy - License policy and exception declarations.
 * @param options - Optional ecosystem filter.
 * @returns Classified rows, findings, summary counts, and overall status.
 */
export function evaluate(records, policy, options = {}) {
  const selected = options.ecosystems ? new Set(options.ecosystems) : null;
  const exceptions = Array.isArray(policy.exceptions) ? policy.exceptions : [];
  const filteredExceptions = exceptions.map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !selected || selected.has(entry?.ecosystem));
  const rows = [];
  const used = new Set();
  const duplicates = new Set();
  const keys = new Set();

  for (const { entry, index } of filteredExceptions) {
    const key = exceptionKey(entry);
    if (key && keys.has(key)) duplicates.add(index);
    if (key) keys.add(key);
  }

  for (const record of records) {
    if (selected && !selected.has(record.ecosystem)) continue;
    const status = record.missingLicense
      ? 'unknown'
      : parseLicense(record.license, policy, record.scope);
    const match = filteredExceptions.find(({ entry }) => matches(entry, record));
    const exceptionUsable = match && !duplicates.has(match.index) && status === 'unknown';
    if (exceptionUsable) used.add(match.index);
    rows.push({ ...record, status: exceptionUsable ? 'review' : status });
  }

  const stale = filteredExceptions
    .filter(({ entry, index }) => !isValidException(entry) || duplicates.has(index) || !used.has(index))
    .map(({ entry }) => entry);
  const violations = rows.filter(row => row.status === 'denied' || row.status === 'unknown');
  const review = rows.filter(row => row.status === 'review');
  const summary = {};
  for (const row of rows) {
    const key = `${row.ecosystem}:${row.scope}:${row.license}`;
    summary[key] = (summary[key] || 0) + 1;
  }
  return { rows, violations, review, stale, summary, ok: !violations.length && !stale.length };
}

/**
 * Checks that an exception has all required nonempty string fields.
 *
 * @param entry - Candidate exception policy entry.
 * @returns Whether the exception has a valid shape.
 */
function isValidException(entry) {
  return ['ecosystem', 'name', 'version', 'license', 'reason']
    .every(key => typeof entry?.[key] === 'string' && entry[key].trim().length > 0);
}

/**
 * Builds a unique key for duplicate exception detection.
 *
 * @param entry - Candidate exception policy entry.
 * @returns Exact identity key, or an empty string for malformed entries.
 */
function exceptionKey(entry) {
  return isValidException(entry)
    ? ['ecosystem', 'name', 'version', 'license'].map(key => entry[key]).join('\u0000')
    : '';
}

/**
 * Tests an exact exception match against a dependency record.
 *
 * @param entry - Candidate exception policy entry.
 * @param record - Dependency record being evaluated.
 * @returns Whether the identity fields match exactly.
 */
function matches(entry, record) {
  return isValidException(entry)
    && ['ecosystem', 'name', 'version', 'license'].every(key => entry[key] === record[key]);
}

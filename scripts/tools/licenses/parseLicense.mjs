const tokenPattern = /^[A-Za-z0-9][A-Za-z0-9.-]*(?::[A-Za-z0-9.-]+)?\+?$/;
const ranks = { allowed: 0, review: 1, denied: 2, unknown: 3 };
const supportedExceptions = new Set(['classpath-exception-2.0', 'llvm-exception']);

/** Tokenize the complete expression, rejecting any unrecognized character.
 *
 * @param expression - SPDX expression to tokenize.
 */
function tokenize(expression) {
  const tokens = [];
  let cursor = 0;
  while (cursor < expression.length) {
    if (/\s/.test(expression[cursor])) { cursor++; continue; }
    const rest = expression.slice(cursor);
    const operator = /^(AND|OR|WITH)\b/i.exec(rest);
    if (operator) {
      tokens.push(operator[1].toUpperCase());
      cursor += operator[0].length;
      continue;
    }
    const punctuation = /^[()+/]/.exec(rest);
    if (punctuation) {
      tokens.push(punctuation[0]);
      cursor++;
      continue;
    }
    const identifier = /^[A-Za-z0-9][A-Za-z0-9.-]*(?::[A-Za-z0-9.-]+)?\+?/.exec(rest);
    if (!identifier) throw new Error('Invalid SPDX token');
    tokens.push(identifier[0]);
    cursor += identifier[0].length;
  }
  return tokens;
}

/** Combine alternatives by their best status and conjunctions by their worst.
 *
 * @param left - Left classification.
 * @param right - Right classification.
 * @param operator - SPDX operator.
 */
function combine(left, right, operator) {
  const rank = operator === 'OR' ? Math.min(ranks[left], ranks[right]) : Math.max(ranks[left], ranks[right]);
  return Object.keys(ranks).find(status => ranks[status] === rank);
}

/** Classify an SPDX identifier according to the supplied policy.
 *
 * @param identifier - SPDX license identifier.
 * @param policy - License policy lists.
 * @param scope - Dependency scope.
 */
function classify(identifier, policy, scope) {
  const normalized = identifier.replace(/\+$/, '');
  const upper = normalized.toUpperCase();
  if (/^(LICENSEREF|DOCUMENTREF)(-|$)/i.test(normalized)) return 'unknown';
  if (policy.allow.some(value => value.toUpperCase() === upper)) return 'allowed';
  if (policy.review.some(value => value.toUpperCase() === upper)) return 'review';
  const denied = policy.deny.some(value => value.endsWith('*')
    ? upper.startsWith(value.slice(0, -1).toUpperCase())
    : value.toUpperCase() === upper);
  if (!denied) return 'unknown';
  return scope === 'dev' && /^(GPL|LGPL)-/.test(upper) ? 'review' : 'denied';
}

/** Parse and conservatively classify a complete SPDX license expression.
 *
 * @param expression - SPDX expression to classify.
 * @param policy - License policy.
 * @param scope - Dependency context, normally shipped or dev.
 * @returns {'allowed'|'review'|'denied'|'unknown'} Classification status.
 */
export function parseLicense(expression, policy, scope = 'shipped') {
  if (typeof expression !== 'string' || !expression.trim()) return 'unknown';
  try {
    const tokens = tokenize(expression);
    let index = 0;
    /** Parse alternatives, preserving SPDX AND precedence.
     *
     * @returns {string} Classification of the alternative expression.
     */
    const parseOr = () => {
      let result = parseAnd();
      while (tokens[index] === 'OR' || tokens[index] === '/') {
        index++;
        result = combine(result, parseAnd(), 'OR');
      }
      return result;
    };
    /** Parse a conjunction of license atoms.
     *
     * @returns {string} Classification of the conjunction.
     */
    const parseAnd = () => {
      let result = parseAtom();
      while (tokens[index] === 'AND') {
        index++;
        result = combine(result, parseAtom(), 'AND');
      }
      return result;
    };
    /** Parse a parenthesized expression or identifier with optional exception.
     *
     * @returns {string} Classification of the atom.
     */
    const parseAtom = () => {
      if (tokens[index] === '(') {
        index++;
        const result = parseOr();
        if (tokens[index++] !== ')') throw new Error('Missing closing parenthesis');
        return result;
      }
      const identifier = tokens[index++];
      if (!identifier || !tokenPattern.test(identifier) ||
          ['AND', 'OR', 'WITH'].includes(identifier.toUpperCase())) {
        throw new Error('Expected identifier');
      }
      const result = classify(identifier, policy, scope);
      if (tokens[index] !== 'WITH') return result;
      index++;
      const exception = tokens[index++];
      if (!exception || !tokenPattern.test(exception) ||
          ['AND', 'OR', 'WITH'].includes(exception.toUpperCase())) {
        throw new Error('Expected exception');
      }
      if (result === 'denied') return result;
      if (result === 'unknown') return result;
      return supportedExceptions.has(exception.toLowerCase()) ? 'review' : 'unknown';
    };
    const result = parseOr();
    return index === tokens.length ? result : 'unknown';
  } catch {
    return 'unknown';
  }
}

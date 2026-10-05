/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Summarize a .cpuprofile: self time by function and inclusive time for named functions.
const fs = require('fs');
const file = process.argv[2];
const limit = Number(process.argv[3] || 25);
const filter = process.argv[4] ? new RegExp(process.argv[4]) : null;
const prof = JSON.parse(fs.readFileSync(file, 'utf8'));
const nodes = new Map(prof.nodes.map(n => [n.id, n]));
const self = new Map();
const counts = new Map();
for (const s of prof.samples) counts.set(s, (counts.get(s) || 0) + 1);
const total = prof.samples.length;
const label = n => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`;
for (const [id, c] of counts) {
    const n = nodes.get(id);
    const k = label(n);
    self.set(k, (self.get(k) || 0) + c);
}
// inclusive
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
const incl = new Map();
for (const [id, c] of counts) {
    const seen = new Set();
    let cur = id;
    while (cur !== undefined) {
        const k = label(nodes.get(cur));
        if (!seen.has(k)) { incl.set(k, (incl.get(k) || 0) + c); seen.add(k); }
        cur = parent.get(cur);
    }
}
const pct = c => (100 * c / total).toFixed(1).padStart(5) + '%';
console.log('samples', total);
console.log('--- self');
[...self].filter(([k]) => !filter || filter.test(k)).sort((a, b) => b[1] - a[1]).slice(0, limit).forEach(([k, c]) => console.log(pct(c), k));
console.log('--- inclusive');
[...incl].filter(([k]) => !filter || filter.test(k)).sort((a, b) => b[1] - a[1]).slice(0, limit).forEach(([k, c]) => console.log(pct(c), k));

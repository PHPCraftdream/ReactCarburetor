# Round 21 integration

## Final independent verdict and contract disposition

Frozen product `9008b8f`: engine P0/P1/P2/P3 = 0/0/2/0; corrected API = 0/0/1/0. Combined three P2, not a zero round. Reports transferred immediately as `1e4cdd2`, correction `c19ee92`, engine `a59043c`.

The API reviewer withdrew metadata-only ordinary descriptor notification as a finding after both reviewers checked the contract: plain state is Object.keys-listed enumerable data keys/values; descriptor introspection is not a value dependency and ordinary snapshots intentionally normalize flags. Acceptance of a descriptor is not an additional notification guarantee. Valid value-changing snapshot restore through accepted readonly fields remains a real defect and was fixed; no new metadata-state semantics or sentinel was introduced.

## Immediate product integration

- `784cbaf`: R21-ENG-01. Watch completes comparison and changed-result detachment before transferring and indexing its complete read set; equal selections still re-file conditional branches, before reentrant onChange writes. Removed the obsolete transfer-brand mock-echo test, retaining consumer regressions.
- `0ded058`: R21-ENG-02 and R21-API-02. Successful actual branch identity replacement invalidates root native alias ownership even when values/paths are unchanged; failure leaves it intact. Restore preflights readonly assignments, deletion feasibility, array tails/additions/order before any sibling mutation. Existing normalized snapshot fallback remains; history classifies exotic/locked-array/readonly traits during its required copy through one scoped callback and replays exact owned endpoints.
- `e8996a7`: installed consumer probes for later watch leaves, equal-content native alias retarget, writable edited snapshot restore and repeated readonly owned replay.
- `3df804e`: Windows-safe consumer launch. The enlarged serialized probe exceeded Windows command-line length (`ENAMETOOLONG`); it now runs from an owned temporary `.cjs` file under the fixture and removes that directory in finally. No consumer scenarios removed.

Proxy helpers were grouped with LSP file moves to preserve layout. LSP failed to update an excluded test import to the moved proxy cache; parent corrected the import after the real test build failure, checked remaining old import literals, and reported the tool inconsistency. No compatibility file retained. Completed repair worktrees and temporary browser scaffolds removed after proof.

## Observed parent verification

- Typecheck/layout passed; code files remain within 600 lines, directories seven entries, one export except Models convention.
- Final lint passed with 44 warnings/no errors, local scratch exclusion not committed.
- Watch-focused parent run 25/25, then 24/24 after removing obsolete transfer instrumentation; actual built Node successive leaf values delivered `{a:2,b:1}` then `{a:2,b:2}`.
- Tracking/paths/history run: 230 tests passed, one file could not build due to LSP's missed moved import. After correction, that proxy cache file passed 13/13. The complete suite subsequently passed **1428/1428**, 132 files, no skips/todos/snapshot changes; 312309 ms reported duration.
- Built CJS↔ESM development/production boundary helper completed **68** actual cases.
- First packed matrix: 15/16, only the Windows large-command launch failure. Corrected complete packed matrix: **16/16**, no skips/failures. React 18/19 npm/pnpm CJS/ESM, mixed selection/history, Next 16.3.5 webpack/Turbopack.
- Actual Chromium connected readonly value `(n|raw writable)` displayed `2|false → 1|true` after valid edited ordinary snapshot restore, `→ 2|false` undo, `→ 1|true` redo. Watch delivered `2|1` then `2|2`; connected native alias after same-content retarget displayed `alias:1 → alias:2`. No browser errors; owned tab/server/bundle removed.

One watch fix worker ran scoped tests despite the explicit no-mid-flight-gates instruction. Parent independently verified its code, tests and built behavior; worker acknowledged the violation. The other fix worker respected the gate boundary.

## Paired bounded workload observations

Seven samples, round-21 copied built baseline versus integrated distribution, after complete suites/matrix:

| Scenario | Baseline median ms | Integrated median ms | Work invariant |
|---|---:|---:|---|
| Ordinary patch history | 0.769 | 0.713 | 128 writes, one capture |
| Resource snapshot history | 34.443 | 31.858 | 64 loads, 128 transitions, 129 captures |
| Populated cache replacement | 0.099 | 0.117 | extra endpoint walks zero both sides |
| Mixed graph capture | 0.262 | 0.260 | original root/row visits one both sides |
| Native alias selection | 0.6619 | 0.8235 | 128 lookups/checksum8128/129 paths; root2/row256 visits both sides |

Ranges overlap; no speedup or allocated-byte claim. Required ownership and linear stable alias selection counts remain intact. No separate full-graph readonly classification pass was added.

## Continuing review

Round-22 xs1 API and engine reviews run independently on identical `3df804e` freezes with final matrix-built ignored dist copied into both trees. Completion still requires a genuinely zero combined P0–P3 review round, not these green checks.

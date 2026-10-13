# Round 23 integration

## Independent verdict and correction

Freeze `889ed14`: API P0/P1/P2/P3 = 0/0/0/0, engine = 0/0/1/0. Reports immediately transferred as `c5d3ecb` and `caabeaf`; combined round not zero.

R23-ENG-01 was fixed inline as one narrow coupled mechanism, committed immediately after proof:

- `be8e156`: History object-payload classification now recognizes the restricted trait, not only locked arrays. Same-kind changed endpoint diffs signal opaque ownership when an enumerable readonly/non-configurable field requires exact replay. The signal is conditional on a real value/key/order change; metadata-only changes remain state no-ops.
- `be8e156`: Initial regression exposed the producer's earlier normalization: an object addition had already lost descriptor flags before history saw it. A shared private `clonePatchValue` now preserves enumerable plain-field descriptors and array length/prototype while retaining opaque leaves by reference. Writer, diff fallback and removed-array endpoint producers use it; ordinary public deepClone/snapshot/restore normalization was not changed.
- `e1956d4`: strict installed CJS probe and mixed-format restrictive replacement/addition/refusal scenarios.

Permanent behavior regressions cover new readonly replacements with both configurable flags, additions across independent histories, later ordinary writes, and changed-sibling versus metadata-only behavior. No compatibility copier aliases retained.

## Observed verification

- Typecheck and layout passed; final lint no errors, 46 warnings, local scratch exclusion not committed.
- Restrictive history admission file: 13/13 after correction. Its first run exposed the normalized producer payload; that real mechanism was fixed, not the assertion.
- One preliminary Node `-e` smoke used sloppy JavaScript: rejected proxy assignment did not throw TypeError. Module tests were already strict. Corrected consumer semantics use a strict CJS script; no product change was made to invent an exception in sloppy JavaScript.
- Actual built development/production CJS↔ESM helper completed **92** boundary cases, including readonly/non-configurable flags and subsequent strict assignment refusal after redo.
- Complete suite: **1453/1453**, 134 files, no skips/todos/snapshot changes; 264104 ms reported duration.
- Packed matrix: **16/16**, no skips/failures; React 18/19 npm/pnpm CJS/ESM, strict mixed-format probe, Next 16.3.5 webpack/Turbopack.
- Actual Chromium connected value/flags displayed `1|true|true → 2|false|false → 1|true|true → 2|false|false` for restrictive replacement, undo and redo. A later readonly write reported `TypeError|true`, retained value/flags `2|false|false`, and kept the version unchanged. No browser errors; owned temporary tab/server/bundle removed.

## Paired bounded workload observations

Seven samples, copied round-23 baseline versus integrated build:

| Scenario | Baseline median ms | Integrated median ms | Work invariant |
|---|---:|---:|---|
| Ordinary patch history | 0.629 | 0.433 | 128 writes, one capture |
| Resource snapshot history | 28.736 | 25.302 | 64 loads, 128 transitions, 129 captures |
| Populated cache replacement | 0.083 | 0.061 | extra endpoint walks zero both sides |
| Mixed graph capture | 0.226 | 0.216 | original root/row visits one both sides |
| Native alias selection | 0.7302 | 0.5642 | 128 lookups/checksum8128/129 paths; root2/row256 visits both sides |

Ranges overlap; no speedup or allocation-byte claim. This is descriptor fidelity correction, not a benchmark-driven performance change.

## Continuing review

Independent xs1 round-24 API/engine reviews run on identical `e1956d4` freezes with final matrix-built ignored dist copied into both worktrees. Completion still requires zero combined P0–P3, not these green checks.

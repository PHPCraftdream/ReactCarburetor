# Round 24 integration

## Review and precise fix

Freeze `e1956d4`: API P0/P1/P2/P3 = 0/0/0/0, engine = 0/0/1/0. Reports immediately transferred as `ddc6934` and `434bf32`; combined round not zero.

R24-ENG-01: ResourceCarburetor owned restore unconditionally assigned its already-correct normalized status through the exact readonly owned endpoint. The one-line correction was applied inline and committed immediately after proof:

- `43ddc49`: skip assignment when `data.status` is already equal to the normalized status. Wire-key ordering, cancellation guards, Pending normalization and ordinary snapshot copy were intentionally unchanged.
- `b8d4a6c`: installed mixed-format consumers cover readonly Idle/Success/Error status replay with timestamp, descriptor flags and usable history cursor.

Permanent consumer regressions exercise two undo/redo rounds for each settled/idle status and both readonly flags, not source wiring.

## Observed verification

- Native/history ownership file: **27/27**, no skips/todos/snapshot changes, including the three new readonly resource states.
- Typecheck/layout passed; one test import exceeded line length after adding the enum and was wrapped. Final lint passed: no errors, 46 warnings, local scratch exclusion not committed.
- Actual strict Node mixed CJS-resource/ESM-history redo returned true, reinstated Idle `updatedAt:7`, retained `writable:false/configurable:false`, and exposed `canUndo:true/canRedo:false`.
- Built development/production CJS↔ESM boundary helper completed **104** cases.
- Complete suite: **1456/1456**, 134 files, no skips/todos/snapshot changes; 316842 ms reported duration.
- Packed matrix: **16/16**, no skips/failures; React 18/19 npm/pnpm CJS/ESM, strict mixed-format probe, Next 16.3.5 webpack/Turbopack.
- Actual Chromium connected resource `(status|updatedAt|writable|configurable)` displayed `idle|none|true|true → idle|7|false|false → idle|none|true|true → idle|7|false|false` for admission, undo and redo. No browser errors; owned temporary tab/server/bundle removed.

## Paired bounded workload observations

Seven samples, copied round-24 baseline versus integrated build:

| Scenario | Baseline median ms | Integrated median ms | Preserved work |
|---|---:|---:|---|
| Ordinary patch history | 0.867 | 0.759 | 128 writes, one capture |
| Resource snapshot history | 14.352 | 14.766 | 64 loads, 128 transitions, 129 captures |
| Populated cache replacement | 0.036 | 0.039 | extra endpoint walks zero both sides |
| Mixed graph capture | 0.124 | 0.117 | original root/row visits one both sides |
| Native alias selection | 0.3196 | 0.2569 | 128 lookups/checksum8128/129 paths; root2/row256 visits both sides |

Ranges overlap; no speedup or allocation-byte claim. The correction removes an unnecessary same-value write, not a new replay abstraction.

## Continuing review

Independent round-25 xs1 API/engine reviews run on identical `b8d4a6c` source/runtime freezes with final matrix-built ignored dist copied into each tree. Completion still requires zero combined P0–P3, not these green checks.

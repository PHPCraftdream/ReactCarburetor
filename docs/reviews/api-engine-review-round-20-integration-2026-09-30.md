# Round 20 integration

## Review and commits

Round-20 product freeze `6079544`: API P0/P1/P2/P3 = 0/0/0/0, engine = 0/0/3/0. API reviewer recovered from the provider's Daybreak Blue access error by resuming the same xs1; no model or executor substitution. Reports transferred immediately as `3fcaaf9` and `eb0aeac`. This was not a zero combined round.

Completed hs1 slices were transferred immediately to master. Commit boundaries preserve the shared producer/observer protocol cutover:

- `1b35069`: R20-ENG-02, ordered own keys participate in detached selection equality; live value reads retain dependencies. Removed two obsolete global-WeakMap allocation instrumentation tests, not re-pinned to implementation.
- `15771e8`: R20-ENG-01/03, ordered key replacement publishes enumeration paths and history records exact owned endpoints for order-sensitive positional string-key changes. `PATCH_KEY_ORDER_CHANGE` is shared across formats, registry dispatch derives its parameter from the recorder contract, and replay adopts the exact fresh graph. Ordinary scalar, integer-key, array-index and trailing-key deletion paths remain patches. Restore preflights append-impossible nested ordering before in-place mutation.
- `9008b8f`: installed consumer probes exercise ordered replacement, selection updates, deletion and exact undo/redo.
- `c6ed41b`: removed the obsolete test explicitly requiring an equal-valued key reorder to remain hidden from a memo child. The new state contract treats insertion order as observable; the old expectation was not re-pinned.

Ordered-container helpers and selection regression files were grouped with LSP moves to preserve seven-entry/600-line/one-export layout. The canonical numeric-key predicate is shared by replacement and deletion classification. Completed repair worktrees and temporary UI scaffolding were removed; independent review freezes remain available.

## Observed verification

- Typecheck and layout passed after fixing a remaining old explicit fanout union and extracting the order-sensitive deletion helper from the 613-line write proxy (now 599 lines).
- Lint passed: no errors, 44 warnings, local `scratch/**` exclusion not committed.
- Focused selection/watch/history run: 138/138 before removing two incidental allocation tests. Final sameSelection run passed after removal.
- Before final helper extraction, actual development/production CJS-to-ESM and ESM-to-CJS boundary probes completed 52 cases. After extraction and rebuild, the development mixed-format probe completed all 26 cases.
- Final packed consumer matrix: 16/16, no skips/failures; React 18/19 npm/pnpm CJS/ESM, mixed-format order/history probes, Next 16.3.5 webpack/Turbopack.
- First full run: 1418 passed and one failure, exclusively the obsolete key-order bailout expectation. After removing it, the remaining file passed 6/6 and the complete suite passed **1418/1418**, 131 files, no skips/todos/snapshot changes; 186268 ms reported duration.
- Actual Chromium connected selection and watch displayed the same order throughout: initial `a,b`; replacement `b,a`; undo `a,b`; redo `b,a`; first-key deletion `a`; undo `b,a`. No browser errors. Temporary tab/server/bundle removed after proof.

## Paired workload observations

Seven-sample existing driver, round-20 built baseline versus integrated output; bounded real workloads, not dummy load:

| Scenario | Baseline median ms | Integrated median ms | Preserved work |
|---|---:|---:|---|
| Ordinary patch history | 0.694 | 0.576 | 128 writes, one capture |
| Resource snapshot history | 30.437 | 31.870 | 64 loads, 128 transitions, 129 captures |
| Populated cache replacement | 0.051 | 0.049 | extra endpoint Object.keys visits zero on both sides |
| Mixed graph capture | 0.132 | 0.126 | original root and row visited once on both sides |
| Native alias selection | 0.9663 | 0.7571 | 128 lookups, checksum 8128, 129 paths; root visits 2, row visits 256 |

Ranges overlap and these are correctness changes, not a speedup claim. Positional string-key changes deliberately use complete owned endpoints because field patches contain no insertion positions; the documented scalar/ordinary-array fast path remains narrow.

## Continuing independent review

Round-21 API/engine xs1 reviewed identical `9008b8f` runtime/source freezes. The subsequent test-only cleanup did not change that product. The combined round is again nonzero: two engine defects (watch read-set filing after early equality exit; stale native alias ownership after equal-content identity replacement) and one API defect (valid snapshot restore/history replay through accepted readonly fields). A metadata-only ordinary descriptor notification observation was explicitly withdrawn by the API reviewer after both reviewers checked the plain-state contract; plain snapshots normalize flags and descriptor introspection is not a value dependency. Reports and correction are integrated as `1e4cdd2`, `c19ee92` and `a59043c`. Separate hs1 worktrees now own the three real mechanisms; no silent expansion of descriptor-state semantics.

# Round 22 integration

## Independent review and completed cutover

Product freeze `3df804e`: engine P0/P1/P2/P3 = 0/0/2/0; API = 0/0/1/0. Reports transferred as `ba26cec` and `8e364c9`. Combined three P2, not a zero round.

Both completed hs1 tasks were immediately transferred to master. Their helper/module relocation and producer/history cutover were committed together after proof, avoiding a broken intermediate import graph:

- `9b2161c`, R22-ENG-01: owned-baseline patch capability admission precedes baseline mutation. Readonly assignment, non-configurable deletion, locked array growth and dependent replacement paths fall back to exact owned endpoints when a patch cannot be installed. Dependent object patches preview on a private copy; primitive batches avoid a dependency trie, and unrestricted scalar paths bypass unnecessary capability work. Restrictive descriptors classify during the required ownership pass.
- `9b2161c`, R22-ENG-02: already-effective paths are attributed before fallible mutation observer delivery. Structured branch/array signals use bounded pending patches rather than a second full diff traversal; delivery continues after a failing observer and retains the first mutation-observer error, including undefined. Replacement, raw publish, restore, deletion, definition and partial array writes preserve publication and independent history.
- `9b2161c`, R22-API-01: restore preflight recognizes changed object-valued locked references before draft traversal or earlier sibling writes; unchanged locked children remain untouched, and valid edited ordinary snapshots use the existing detached fallback.
- `889ed14`: installed cross-format probes cover readonly branch admission, locked object restore, scalar and multileaf observer errors with exact error identity, version/watch updates and independent undo.

Watch runner extraction retains full read collection before filing and uses a module-level runner, not a new per-watch closure. Ownership/admission/equality helpers are grouped in Tooling/Graph; canonical facade registry is grouped in Tracking/Proxy without changing its shared singleton identity. Public root exports and the built CarburetorHistory module path remain unchanged; no compatibility modules kept.

LSP relocation malformed one helper import as `../ownHistoryGraphyGraph`; the actual compiler exposed it. Parent corrected it after no language-server code action was available and reported the tool issue. All subsequent gates passed. Completed repair worktrees and temporary UI scaffolding removed after proof.

## Observed parent verification

- Typecheck/layout passed after correcting the buffered recorder union, malformed import and directory grouping; <=600 code lines/seven directory entries/one export conventions retained.
- Final lint passed, no errors and 46 warnings. Local scratch exclusion not committed; intentional raw-publish fixture warning retained, not suppressed.
- Focused watch/observer/history run: **136/136**, nine files, no skips/todos/snapshot changes. Final history run after admission fast-path cleanup passed.
- Built development/production CJS↔ESM boundary helper: **84** cases; final development mixed-format rerun: 42 cases.
- Full integrated suite: **1449/1449**, 134 files, no skips/todos/snapshot changes; 456044 ms reported duration.
- Packed consumer matrix: **16/16**, no skips/failures. React 18/19 npm/pnpm CJS/ESM, mixed-format selection/history/error probes, Next 16.3.5 webpack/Turbopack. File-based Windows consumer launch preserved every scenario.
- Actual Chromium: readonly branch replacement/history displayed `history:1 → history:2 → history:1 → history:2`. A throwing mutation observer still rendered `observed:2`, preserved exact error identity and version 1 (`true|1`), and independent history undo rendered `observed:1`. Locked object snapshot restore displayed both requested values `4|2`. No browser errors; owned tab/server/bundle removed.

## Paired bounded workloads

Seven samples of existing real drivers after suites/matrix, copied round-22 baseline versus integrated distribution:

| Scenario | Baseline median ms | Integrated median ms | Preserved work |
|---|---:|---:|---|
| Ordinary patch history | 0.898 | 0.779 | 128 writes, one capture |
| Resource snapshot history | 33.021 | 30.556 | 64 loads, 128 transitions, 129 captures |
| Populated cache replacement | 0.098 | 0.114 | extra endpoint walks zero both sides |
| Mixed graph capture | 0.135 | 0.175 | original root/row visits one both sides |
| Native alias selection | 0.7197 | 0.4657 | 128 lookups/checksum8128/129 paths; root2/row256 visits both sides |

Ranges overlap; no speedup or allocation-byte claim. Primitive admission does not allocate dependency-trie nodes; required complex/restrictive admission remains conservative and privately owned.

## Continuing review

Independent round-23 xs1 API and engine reviews run on identical `889ed14` freezes with the final packed-matrix built ignored distribution copied into both worktrees. Green checks and closed findings do not establish the required zero combined review round.

# Round 18 integration

## Review and integration

Freeze: round 18 product `60e4cb8`; reports integrated as `ca3501f` (API) and `c3fdb64` (engine). API counts P0/P1/P2/P3: 0/0/0/0. Engine: 0/0/2/0. This was not a zero-finding round.

Completed isolated hs1 work was transferred immediately to master and committed separately after integrated proof:

- `0acfe71`: R18-ENGINE-01, native Map/Set member/key/own-data/root backlink reads subscribe to ordinary writable plain aliases. Raw entries retain identity. Unrelated plain writes do not rerender a narrow connected member read.
- `b9a290b`: R18-ENGINE-02, accepted array length content/descriptor-only locks publish and restore through history; failed pre-install restore retains a retryable cursor. Partial nonconfigurable truncation, sparse contents, independent deferred histories, and native graph backlinks are covered.
- `f1f1f06`: documentation and mixed-format consumer boundary scenarios.

Alias implementation/development ledger and tracking boundary tests were grouped into cohesive directories using LSP file moves. Existing seven-entry/600-line/one-export layout passed. No package version changes or push. Ignored local dist was rebuilt, not staged.

## Observed verification

- Typecheck and layout: passed.
- Lint with local `scratch/**` exclusion: no errors, 44 warnings. The exclusion was not committed.
- Focused tracking/history/connected-native regression run: 192/192, 13 files, no skips/todos/snapshot changes.
- Full suite: 1388/1388, 129 files, no skips/todos/snapshot changes, 255244 ms reported duration.
- Development/production build: passed.
- Actual built CJS-to-ESM and ESM-to-CJS boundary script: 36 cases across development and production. Map value, Set member, Map key, native own field, root backlink; root/nested sparse array length truncation and descriptor-only locking.
- Packed consumer matrix: 16/16, no skips/failures. React 18/19, npm/pnpm, CJS/ESM, mixed-format selection, Next 16.3.5 webpack/Turbopack. Existing history consumer scenarios retained.
- Actual Chromium connected class surface: initial `1|2|true`, render count 1; unrelated write unchanged/count 1; plain row write `2|2|true`, count 2; length lock `2|1|false`, count 3; undo `2|2|true`, count 4; redo `2|1|false`, count 5. No browser errors. Owned temporary server, browser tab and bundle removed.

## Performance observations and open review risks

Paired existing resource-history driver after full tests completed, seven samples per workload, baseline round-18 built dist versus integrated main:

| Workload | Baseline median ms | Integrated median ms | Invariant |
|---|---:|---:|---|
| Ordinary patch history | 0.418 | 0.336 | 128 writes, one capture |
| Resource snapshot history | 19.474 | 25.150 | 64 loads, 128 transitions, 129 captures |
| Mixed graph capture | 0.215 | 0.182 | one capture, original root/row visits both one |

Resource ranges overlap (12.017–28.312 versus 18.727–29.140 ms); no improvement claim. New locked-array classification traversals are an open review risk.

A bounded actual production selection of all 128 native Map members aliased to 128 plain rows returned the same sum 8128. Seven-sample median: baseline 0.0899 ms (one recorded path), integrated 4.635 ms (129 paths). Baseline lacked required alias tracking, so this is a correctness-cost comparison, not equivalent-behavior speedup evidence. Repeated full-root traversal per exposed member is an open amplification risk supplied to independent round-19 engine review.

## Next independent freeze

Round 19 API and engine xs1 reviews run on identical `f1f1f06` worktrees with rebuilt ignored dist copied into each. Parent owns all suite/build/lint/benchmark verification; reviewers run only bounded reproductions and commit their report. Completion still requires a genuinely zero combined P0–P3 round, not green checks.

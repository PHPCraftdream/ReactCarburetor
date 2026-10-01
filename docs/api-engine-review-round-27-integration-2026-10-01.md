# Round 27 integration

## Independent verdict and complete correction

On freeze `7c2f9ea`, xs1 API established **P0/P1/P2/P3 = 0/0/0/0**; independent xs1 engine established **0/0/1/0**. Reports immediately transferred as `e5bdd6b` and `f5eac18`. API zero alone did not finish: R27-ENG-01 was a real P2, ordinary resource/cache operations applying history-only rejection to unrelated native accessor metadata without history attached.

Completed hs1 worktree tasks were immediately transferred into master, verified and committed:

- `713ffdc`: operational `cloneOwnedGraph(..., opaqueByReference=true)` preserves native Map/Set/Date accessor descriptors with `Object.defineProperty`, without invoking getter/setter. Native contents and own data fields retain the existing cycle ledger and alias/backlink remapping. Default strict history and trackable plain accessor refusal remain unchanged. The obsolete ordinary-runtime native-accessor refusal test was removed, replaced by actual readonly slot suspend/abort/error/reload behavior and exact strict-history refusal. README/CHANGELOG explain the runtime/history boundary.
- `a9200c0`: mixed-format built consumers verify readonly slot loading and locked cache removal followed by readonly refresh, accessor noninvocation, exact getter identity, native root/entry backlinks and original endpoint restrictions.
- `64a5d23`: cache regressions cover load/refresh deduplication and settlement, raw rejection identity, abort/new-request ownership, physical locked-key forget, and maxEntries eviction preserving a watched native-linked sibling. No separate cache production patch was necessary: existing callers already explicitly requested operational graph ownership.

Shared helper had one worker owner; cache worker consumed that candidate in its own isolated tree and did not deliver a competing helper. No getter evaluation, native-by-reference backlink breakage, fake ledger removal or swallowed exception. Accessor-bearing actual history remains intentionally unsupported. No new traversal or payload copy was added beyond the required operational complete graph ownership.

## Observed parent verification

- Typecheck/layout passed: maximum seven directory entries, 600 source lines and one export per file.
- Final lint passed with no errors, 50 warnings; local scratch exclusion not committed.
- Focused slot **16/16** and cache/history **13/13**: 29 tests across three files, no skips/todos/snapshot changes.
- Initial new eviction regression incorrectly assumed a supplied writable root never received the preceding ordinary Pending insertion. The source already publishes that insertion before locked removal. Removed that incidental key-set assumption; assert actual old locked slot/owner/flags remain preserved instead, alongside actual live removal, watched survivor, answer and alias invariants. No production suppression or re-pinning of the intermediate key set.
- Built development/production CJS↔ESM runtime boundary helper: **148** actual cases passed.
- Full regression suite: **1490/1490**, 138 files, no skips/todos/snapshot changes; reported duration **206067 ms**.
- Packed consumers: **16/16**, no skips/failures; React18/19 npm/pnpm CJS/ESM, strict mixed-format probe and Next16.3.5 webpack/Turbopack.
- Actual Chromium actions loaded a readonly slot to `slot-new` with one loader call, physically forgot locked key `a`, and refreshed readonly `b` to `b!` with one cache loader call. Getter/setter invocation counters remained **0/0**. Actual history capture refused the native accessor. Native root/entry backlinks, exact getter function, held readonly status and held original locked slot stayed intact; no browser errors. Owned tab/server/bundle removed.
- Completed hs1 fix trees/junctions removed after proof. Empty-source warning from cross-file test register transfer was reported as a tool inconsistency; main received the complete regression file. No generated dist staged.

## Bounded paired workload observations

Seven real workload samples, copied round-27 engine baseline versus integrated production build:

| Scenario | Baseline median ms | Integrated median ms | Preserved work |
|---|---:|---:|---|
| Ordinary patch history | 0.547 | 0.345 | 128 writes, one capture |
| Resource snapshot history | 13.689 | 15.197 | 64 loads, 128 transitions, 129 captures |
| Populated cache replacement | 0.037 | 0.042 | extra endpoint visits zero both sides |
| Mixed graph capture | 0.117 | 0.112 | root/row visits one both sides |
| Native alias selection | 0.2620 | 0.2519 | 128 lookups/checksum8128/129 paths; root2/row256 visits |

Ranges overlap; no speedup or allocation-byte claim. Resource ranges baseline 11.153–15.971 ms, integrated 11.462–18.131 ms. R27 is a correctness boundary fix, not a new throughput optimization.

## Continuing independent review

Round-28 broad independent xs1 API/engine reviews run on identical `64a5d23` source freezes and latest matrix-built ignored distributions. Closed R27 manifestations and green gates are not a zero combined review.

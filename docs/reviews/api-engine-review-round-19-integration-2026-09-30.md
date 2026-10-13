# Round 19 integration

## Independent review and immediate commits

Round 19 freeze: `f1f1f06`. API report integrated as `e4ae753`: P0/P1/P2/P3 = 0/0/2/0. Engine report integrated as `f8fcc09`: 0/0/1/1. Combined: **0/0/3/1; not a zero round**.

Each completed hs1 worktree task was immediately transferred to master, proved, and committed separately:

- `2f8f63e`, R19-API-02: cache requests cancelled or superseded synchronously during Pending publication before loader invocation reject with AbortError. Reentrant replacements retain their own request ownership; previous successful data and raw failure remain intact. Ordinary post-loader abort semantics were not broadened.
- `728d5c8`, R19-API-01: persistent array reflection remains lawful over its shared writable proxy target through raw length locks, undo/redo and retargeting. Detachment and selection comparison use canonical raw descriptor flags, retaining locked snapshots and stable unchanged selection identity.
- `ce08c7f`, R19-ENGINE-02: lock classification occurs in the required history ownership/capture pass. Baseline metadata follows clear/replay/no-ops/patch transitions; locked subtrees still use owned complete endpoints. Primitive-only patches bypass new callback/copy allocation.
- `b33be10`, R19-ENGINE-01: stable native exposures reuse a weak root-owned ordinary path index. Draft/native mutations, setData and raw publication invalidate ownership; entries stay raw, aliases precise, and root backlinks coarse. Tracking benchmark drivers were grouped to preserve the seven-entry directory contract.
- `6079544`: packed consumer probes also exercise connected-array reflection across locks/time travel/replacement and cache pre-loader cancellation/retry.

No version bump, push or staging of ignored dist. User scratch/scheduled-task material was excluded from task commits.

## Observed verification

- Integrated typecheck and layout passed.
- Lint with local `scratch/**` exclusion passed with 44 warnings, no errors; exclusion not committed.
- Cache reentrancy regression: 22/22.
- Connected facade/history run: 125/125; final primitive-path history run: 80/80.
- Indexed native tracking and connected render: 116/116; latest adjusted alias regression run: passed.
- Full integrated suite: **1402/1402**, 129 files, no skips/todos/snapshot changes; reported duration 202380 ms.
- Production/development builds passed. Actual mixed CJS/ESM boundary helper completed 44 cases across both build modes before final index transfer; the final packed matrix exercised the integrated index and new helper.
- Final packed matrix: **16/16**, no skips/failures, React 18/19 npm/pnpm CJS/ESM, mixed-format selection/history, Next 16.3.5 webpack and Turbopack.
- Actual Chromium connected array surface queried facade length descriptors every render. Display `(view length|descriptor value|raw writable)` changed `2|2|true → 1|1|false → 2|2|true → 1|1|false → 3|3|true` for lock, undo, redo and source swap. Cache button displayed `AbortError|0|1|ready`: no cancelled loader invocation, one successful retry invocation. No browser errors. Owned temporary tab/server/bundle removed after proof.

## Paired performance proof

Baseline: round-19 review dist (pre-fix, correct R18 alias tracking). Fixed: integrated dist. Seven samples; bounded real scenarios, no dummy load.

Native alias selection, 128 distinct rows/128 Map.get calls/checksum 8128/129 recorded paths on both sides:

| Measurement | Baseline | Fixed |
|---|---:|---:|
| Median selection ms | 4.8976 | 0.3281 |
| Original root descriptor visits | 256 | 2 |
| Original row descriptor visits | 16512 | 256 |

Driver: `benchmarks/state/tracking/nativeAliasSelection.mjs`. Reflection counts are not allocation-byte measurements. Ownership discovery is linear for this stable selection, not a full-root search per member.

Existing paired history driver, extended with populated eight-entry ResourceCache public setData and undo/redo:

| Scenario | Baseline median ms | Fixed median ms | Work invariant |
|---|---:|---:|---|
| Ordinary patch history | 0.341 | 0.314 | 128 writes, one capture |
| Resource snapshot history | 19.442 | 14.677 | 64 loads, 128 transitions, 129 captures |
| Populated cache replacement | 0.037 | 0.035 | one replacement capture, reversible data |
| Mixed graph capture | 0.133 | 0.165 | one capture, original root/row visits one each |

Owned-endpoint Object.keys counters for the populated-cache scenario: root 2→0, dictionary 2→0, selected entry bodies 8→0. Mixed-capture ranges overlap (0.128–0.185 versus 0.122–0.241 ms); no speedup claim for that scenario. Driver: `benchmarks/state/resourceHistory.mjs`.

## Continuing independent review

Round 20 xs1 API and engine reviewers run independently on identical `6079544` worktrees with the final packed-matrix built dist copied into each. Green tests and the closed four findings do not establish the required zero combined review round.

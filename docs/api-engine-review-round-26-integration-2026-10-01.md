# Round 26 integration

## Independent verdict and completed corrections

The API review established one P2; the engine review established two P2, with its request-registration finding overlapping the API's readonly restart finding. No P0/P1/P3; two distinct mechanisms, not a zero combined round. Report-only commits transferred immediately as `64f44b0` and `e7c67de`.

Completed hs1 worktree slices were transferred into master, verified and committed without waiting for zero:

- `c401e08`: private operational graph copying may preserve unsupported opaque payload references explicitly; strict history graph ownership remains the default. Actual source smoke proved strict rejection, operational nested class identity, native root backlinks and source isolation.
- `f8103a8`: single-slot requests prepare writable operational lifecycle fields before registration, publish joinable Pending only after ownership is installed, and unwind only their own failed publication. Readonly held history endpoints remain untouched; cancellation, suspend, reload, raw failures and synchronous supersession remain supported. Preparation is grouped in `Resource/prepareSlotRequest.ts`.
- `c695e7c`: cache request preparation precedes registration; fallible pre-loader publication cannot leave a never-started shared promise. Non-configurable dictionary slots are physically removed by owned graph replacement before eviction bookkeeping acknowledges removal. Surviving raw failure owners are rebound across replacement. Current reentrant owners remain authoritative. Coherent State/Mutation helpers keep one export per file and source files within the existing layout limits.
- `7c2f9ea`: installed mixed-module consumers exercise readonly slot/cache restart, readonly successful refresh, locked eviction and locked forget; README/CHANGELOG explain operational capabilities, request failure unwind and actual deletion.

No readonly direct-draft write bypass, speculative retry, swallowed original failure, fake pinned cache slot or expanded metadata-only notification contract. Prepared cache graphs initialize operational Pending/refreshing before publication; raw rejection rebinding is a shared state-mutation helper rather than duplicated traversal. Static request-field names avoid per-load `Object.keys` allocation. Completed fix trees/junctions and browser scaffolds were removed after proof; main dist remains ignored.

## Observed parent verification

- Typecheck and layout passed: at most seven entries per directory, 600 lines per code file and one export per file.
- Lint passed with no errors and 50 warnings; local scratch exclusion not committed. Initial layout failure (613-line cache lifecycle) was resolved by cohesive helper extraction, not comment trimming. LSP's sequential move corrupted a sibling helper import; no code action was available, the exact import was repaired and the tool inconsistency reported.
- Focused slot/cache/reentry suite: **45/45**, three files, no skips/todos/snapshot changes.
- Built development/production CJS↔ESM runtime boundary helper: **140** actual cases, all passed.
- Complete regression suite: **1484/1484**, 137 files, no skips/todos/snapshot changes; reported duration **207580 ms**.
- Packed consumers: **16/16**, no skips/failures; React 18/19 npm/pnpm CJS/ESM, strict mixed-format probe, Next 16.3.5 Turbopack/webpack.
- Actual Chromium button surface: readonly replay Idle (`status.writable=false`) → Pending (`writable=true`, loader calls one) → Success `slot-new`; `suspend` returned `slot-new` without another load. Readonly cache refresh returned `a!`; loading `b` under maxEntries one removed real key `a` and settled `b!`. Slot/cache root backlinks remained correct. Held original slot/cache readonly descriptors, original refreshing=true and original locked slot presence remained unchanged. No browser errors. Owned tab/server/bundle removed.

## Bounded paired workload observations

Seven samples, copied round-26 engine baseline versus integrated production build; genuine history and alias workloads, not artificial machine load:

| Scenario | Baseline median ms | Integrated median ms | Preserved work |
|---|---:|---:|---|
| Ordinary patch history | 0.341 | 0.282 | 128 writes, one capture |
| Resource snapshot history | 11.753 | 13.517 | 64 loads, 128 transitions, 129 captures |
| Populated cache replacement | 0.030 | 0.032 | extra endpoint visits zero on both sides |
| Mixed graph capture | 0.112 | 0.111 | original root/row visits one on both sides |
| Native alias selection | 0.3952 | 0.3189 | 128 lookups, checksum8128, 129 paths; root2/row256 visits |

Ranges overlap; no speedup or allocation-byte claim. Writable resource history ranges 11.094–13.826 ms baseline versus 10.831–17.068 ms integrated. Restricted operational transitions require an owned replacement rather than mutating a captured endpoint; ordinary writable requests do not clone the whole graph.

## Continuing independent review

Round-27 xs1 API and engine reviews run on identical `7c2f9ea` source freezes with fresh ignored built outputs and isolated worktrees. Both are broad independent reviews; all three R26 reported manifestations are closed, but passing gates do not establish zero P0–P3.

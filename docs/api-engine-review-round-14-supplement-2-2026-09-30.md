# Round 14 supplemental integrated-source observations 2 — 2026-09-30

Integration-owner acceptance probes, not an xs review or a zero-findings round. Product fixes were made by Sol6/high owners in isolated worktrees; product changes remain uncommitted.

## Additional supported P2 paths

| ID | Before | Required invariant and observed after |
|---|---|---|
| R13-E03C | A persistent plain/array root facade and its raw root used as a Map key were not canonicalized together. | A class selecting both forms rendered `lookup: answer, alias: true`. Ten mounted plain/null/array/Object.prototype-array/null-array × traversal-order cases preserve Map lookup, Set membership, detached root identity and retargeting after replacement/source swaps. |
| R13-E03D | Detachment copied normalized facade reflection flags rather than the owned raw descriptor's flags. | Actual class selection preserves a legal enumerable, non-writable, non-configurable id descriptor as `[true,false,false]`; mounted graph cases retain raw descriptor flags. |
| R14-API-02A | Single-slot raw-error reconciliation only covered public whole-state replacement, not a subclass's public draft/update action. | An observer of a legal subclass action saw Error `changed-by-action` throw that message, then Success serve `ready`; neither event exposed the old raw rejection. No key was invented. |
| R13-API-01A | Keyed-cache raw-failure ownership did not reconcile a subclass's draft/update rewrite before publication. | An observer saw Error `changed` throw that message, then Success serve `ready`; an unrelated entry retained its original raw rejection. Precise error/status writes inspect only their owning failure; coarse publication scans the existing failures without per-entry callback allocation. |

## Native-facade supplement closure

- R14-E02A: actual class source smoke rendered a detached native root with value 1 and an intact self-cycle, without a false live-escape diagnostic. Mounted Map/Set/Date cases follow whole-state replacements and source swaps; mutating each snapshot leaves its source unchanged.
- R14-E02B: source probes of own `forEach` accessors on Map/Set and own `getTime` on Date reject with getter count **0**. Native copies use intrinsics on the owned raw receiver; data-method shadows and native contents remain independently covered.
- A mounted source-backed sparse-array length consumer rendered 3, then 5 after replacement, with two renders.

## Verification and an incorrect test consumer

The first final focused run passed 124/130; six array-root cases failed the narrow-reader assertion. Sol6/high traced this to the fixture, not an engine wildcard regression: `aliasFields(array).id` read Map and Set slots before id, legitimately adding those dependencies. The corrected narrow consumer reads only array index 2 or object id. The unchanged-render assertion and every graph/descriptor/retarget assertion remain. Its independent mounted source probe produced render counts `[1,2,2]` for all five root shapes.

Final integrated focused run: **130/130 in 13 files**, no skips or snapshot changes. Typecheck, lint with zero errors, layout, all four runtime formats and declarations passed. The full suite and fresh packed npm/pnpm/React/Next consumer matrix were started afterward; this report does not assert their outcome or a zero xs round.

# Native alias invalidation: decision record (2026-10-19)

Status: decided, no code change. Findings PERF-03, PERF-14 and ALGO-12 of the 2026-10-16 reviews
are closed as "not done, on purpose". This record exists so the attempt is not repeated without the
evidence listed at the end.

## Question

`recordNativeAliasReads` caches, per live root generation, which plain paths a native value (`Map`,
`Set`, `Date`, class instance) exposes. The documented contract is that an in-place mutation of the
native value is picked up only after the next topological write; every container write bumps the
root generation, and a draft mutation of a `Map`/`Set` facade discards the whole ownership index.
The reviews proposed narrowing that invalidation (cheaper `Map`/`Set` mutations, per-object
generations, a per-object scalar-leaf verdict cache). Should the contract change?

## Decision

Keep the contract and the implementation as they are (option A). Two independent read-only
reviews (a strong reviewer model and a second analyst) reached the same conclusion.

| Proposal | Outcome | Reason |
|---|---|---|
| Keep the ownership index on `Map`/`Set` facade mutations (only bump the generation) | Rejected | Gains nothing: reading a native through `draft` already drops the index (`noteChange` with `previous === next` falls back). Unsafe: a plain child handed out by `Map.get()` can be replaced behind the set trap, leaving the index stale and the subscription lost. |
| Per-object generations validated against each answer's own exposed set | Rejected | Silent breaking change. The documented "visible after the next topological write" guarantee, `aliases43/precision` and `alias39/*` all rely on the global bump. |
| Per-object scalar-leaf verdict cache for `Date` | Rejected | Equivalent to the previous item: nothing observes `Object.defineProperty` on a raw `Date`, so a cached verdict would never refresh. |
| Repair the ownership index for positional array moves | Optional, P3 | Safe only with the invariant `paths(root)` equals a freshly built `buildOwnershipIndex(root)` after every operation, plus a differential test. Gains only when the array is a small part of the store. |

## Cost of keeping it

Observed only on stores with at least ~10k plain containers behind native members and frequent
`Map` writes: the first native read after a write rebuilds the ownership index, O(plain containers).
A single measured point exists (about 62 ms for a 50k-row full rebuild, before the R39 repairs);
the per-cycle cost at 10k rows is inferred to be around 10 ms. Stores whose natives hold only
primitives (`Map<id, number>`, bare `Date`) never build the index.

## Conditions to reopen

Reopen only with all of the following:

1. A gate measuring the real pattern (a `Set<string>` toggle next to a `Map<id, Row>` read, rebuilds
   per cycle) that shows a meaningful cost.
2. A red test on the naive implementation: hold a facade, force an index rebuild between the handout
   and the hidden replacement (`facade.get(k).child = x`), then `facade.set(...)`, subscribe, and write
   `draft.branch.child`; the naive version loses the update.
3. A design that is conservative for every handout path (`get`, `forEach`, iterators, own fields) and
   keeps `aliases43/precision`, `alias39/*` and the retired-root cases green without amendments.

A narrower variant that stays inside the contract: mark natives whose content can reach no plain
object (a monotonic `WeakSet`), and keep the cheap path only for those.

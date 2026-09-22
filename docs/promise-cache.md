# Promise cache: design notes

The engine already has `ResourceCarburetor` — one async value with a status, deduplication and
abort. It holds a *single* slot: loading with different arguments aborts the previous request and
overwrites the same state. That is the right shape for "the current user's profile" and the wrong
shape for an API layer, where the same loader is called with many arguments and the answers are
worth keeping.

`ResourceCache` is that second shape: many entries keyed by arguments, each with its own status and
freshness. The goal is that a consumer does not reach for TanStack Query — not that this becomes
TanStack Query.

## Non-goals

Stated up front, because each one is a whole subsystem and pretending otherwise is how a cache
becomes a framework:

- **retries with backoff** — a failed request stays failed until something asks again;
- **refetch on window focus, reconnect or interval** — no global listeners are installed;
- **pagination and infinite lists** — no cursor or page-merging logic;
- **normalisation** — entries are whatever the loader returned, not a graph of entities;
- **optimistic updates** — a mutation is the consumer's own store write.

## The shape of the data

One carburetor holding a flat dictionary:

```ts
interface IResourceCacheData<T> {
    entries: IDict<IResourceEntry<T>>;
}
```

When an entry was last used is **not** in there. It is bookkeeping rather than state, and putting it
in the entry would make `getEntry` write to the store on every read — breaking the rule this design
states two sections down, and putting a meaningless field into dehydrated output.

Flat and keyed by string, because that is what makes path precision work for free: a component
reading `entries.<key>.data` subscribes to exactly that entry, and writing another entry's data
wakes nobody else. Nesting by argument shape, or keeping entries in a `Map`, would both throw that
away — a `Map` is untrackable (see [hazards.md](hazards.md), H19) and would make every write
invalidate the whole cache.

## The key is escaped, and this is not cosmetic

Paths in this engine are dot-separated, and matching treats a prefix as an ancestor. A key built by
`JSON.stringify` can contain dots, and then two unrelated entries become relatives. Measured on the
built engine before any of this was written:

```
entries.a   read by one subscriber
entries.a.b written by another entry
pathsIntersect(...) === true      // writing entry "a.b" wakes the reader of entry "a"
```

So the key is escaped, JSON-Pointer style: `~` becomes `~0`, `.` becomes `~1`. The same probe with
escaped keys returns `false`. The escape is reversible, which keeps the key readable in devtools —
`{"id":"a~1b"}` is still recognisably the argument that produced it — and it is the only
transformation applied, because the dot is the only character path matching gives meaning to.

`WILDCARD_PATH` is `"*"`, and a key can never equal it: the key is always JSON, so it always carries
a quote, a digit or a brace. A test pins that, because if it ever stopped being true, one entry would
silently subscribe to the entire cache.

## Freshness is lazy, and a read never writes

The default TTL is 30 seconds, and `Infinity` means an entry never goes stale. A default of zero —
which is what the hooks libraries use — would make every read refetch and leave the cache as nothing
but a deduplication layer, which is a surprising thing for something called a cache.

An entry records `updatedAt`. Whether it is stale is computed when someone asks —
`Date.now() - updatedAt > ttl` — and never by a timer. Timers would mean a handle per entry to leak,
wake-ups in an idle tab, and a cache that keeps the process alive.

The consequence to respect: **reading a stale entry must not start a request during render.** Writing
to a store from render notifies subscribers mid-render (hazards.md, H11) and React reports it as an
update-depth error far from the cause. So a read reports staleness and nothing else; the refetch is
triggered from an effect, or from the microtask after the render commits. The component API does the
triggering, so a consumer never has to remember this.

## A failed refresh keeps the good data

`ResourceCarburetor.settleError` moves the state to `Error`, which makes the previous value
unreachable. For a cache that is wrong: the interface should show the last known data *and* that
refreshing failed. So an entry keeps `data` across a failed refresh and carries the error separately,
and only an entry that never succeeded lands in `Error` with nothing to show.

For the same reason, refreshing an already-successful entry does not move it back to `Pending`:
there is nothing to put in place of the data, and flashing a spinner over data the user is reading is
a regression, not a loading state. The refresh is visible as a separate flag.

## The public surface

| Member | Purpose |
|--------|---------|
| `getEntry(args)` | The entry as it is now, with a `stale` verdict. Does not start anything, and does not write — `Carburetor.read` is the tracked-read API, so this one is named after `getData`. |
| `load(args)` | Resolves from the cache when fresh, otherwise fetches. Concurrent identical calls share one request. |
| `refresh(args)` | Always fetches, ignoring freshness. Replaces the entry on success, keeps it on failure. |
| `invalidate(args)` | Marks one entry stale without touching its data. Never refetches: entries being read refetch on their next read, and `refresh` fetches one now. Also clears `failed`, re-arming an entry whose last attempt failed. |
| `invalidateAll()` | Marks every entry stale and re-arms any failed entry, the usual move after a write the server accepted. Never refetches. |
| `forget(args)` | Removes one entry, cancelling its request first so a late answer cannot resurrect it. |
| `forgetAll()` | Removes every entry. |
| `suspend(args)` | Reads for Suspense: throws the in-flight promise, or the error. |
| `abort(args)` | Cancels one entry's in-flight request, leaving whatever data the entry already holds. |
| `abortAll()` | Cancels every request in flight. |

The one-entry and all-entries variants are separate methods rather than one optional argument:
arguments can be `void` — `load()` takes none then — so an argument-less `abort()` would be
genuinely ambiguous between "this one entry" and "all of them".

Eviction is not optional: without it the cache grows by one entry per distinct argument set for the
lifetime of the process. A maximum entry count is set in the constructor, least-recently-used entries
go first, and an entry is never evicted while a request for it is in flight or while a component is
subscribed to it.

## Server rendering

The cache is a carburetor, so `CarburetorScope.dehydrate()` already serialises it and `hydrate()`
already restores it. The open question is `updatedAt` across the boundary: the server's clock wrote
it, the client's clock reads it. Treating it as absolute makes an entry look fresh or stale by the
difference between two machines' clocks. The decision is to keep `updatedAt` as the server wrote it
and let the client's first read judge it with its own clock — the error is bounded by clock skew,
which is smaller than any sensible TTL — and to document that a hydrated entry is deliberately
considered *fresh* for its remaining TTL rather than refetched on mount, because refetching
everything on hydration is the cost server rendering was meant to avoid.

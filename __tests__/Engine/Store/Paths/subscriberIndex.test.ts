import {TPath, TPathSet} from "@/Carburetor/Models/Paths";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {pathsIntersect} from "@/Carburetor/Store/Paths/Diff/pathsIntersect";
import {SubscriberIndex} from "@/Carburetor/Store/Paths/SubscriberIndex";

const setOf = (...paths: TPath[]): TPathSet => new Set<TPath>(paths);

/** The straightforward scan the index replaces — the reference implementation. */
const matchByScan = (readsById: Map<string, TPathSet>, writes: TPathSet): Set<string> => {
    const matched = new Set<string>();

    readsById.forEach((reads: TPathSet, id: string) => {
        if (pathsIntersect(reads, writes)) {
            matched.add(id);
        }
    });

    return matched;
};

const sorted = (ids: Set<string>): string[] => Array.from(ids).sort();

/** Counts index/bucket writes, so a re-registration's cost is observable, not just its result. */
class SpyIndex extends SubscriberIndex {
    public registerCalls: number = 0;
    public unregisterCalls: number = 0;

    protected override register(target: Map<TPath, string | Set<string>>, path: TPath, id: string): void {
        this.registerCalls++;
        super.register(target, path, id);
    }

    protected override unregister(target: Map<TPath, string | Set<string>>, path: TPath, id: string): void {
        this.unregisterCalls++;
        super.unregister(target, path, id);
    }

    protected override registerBranch(path: TPath, id: string): void {
        this.registerCalls++;
        super.registerBranch(path, id);
    }

    protected override unregisterBranch(path: TPath, id: string): void {
        this.unregisterCalls++;
        super.unregisterBranch(path, id);
    }

    public resetCounts(): void {
        this.registerCalls = 0;
        this.unregisterCalls = 0;
    }
}

/** Exposes the raw buckets for representation checks. */
class InspectableIndex extends SubscriberIndex {
    public exactBucket(path: TPath): string | Set<string> | undefined {
        return this.exact.get(path);
    }

    public branchBucket(path: TPath): string | {id: string; count: number} | Map<string, number> | undefined {
        return this.branch.get(path);
    }
}

describe('SubscriberIndex', () => {
    test('matches a write to the path that was read', () => {
        const index = new SubscriberIndex();

        index.add('reader', setOf('a'));

        expect(sorted(index.match(setOf('a')))).toEqual(['reader']);
        expect(sorted(index.match(setOf('b')))).toEqual([]);
    });

    test('matches readers sitting below the written path', () => {
        const index = new SubscriberIndex();

        index.add('deep', setOf('items.a1.title'));

        expect(sorted(index.match(setOf('items.a1')))).toEqual(['deep']);
        expect(sorted(index.match(setOf('items')))).toEqual(['deep']);
        expect(sorted(index.match(setOf('items.a2')))).toEqual([]);
    });

    test('matches readers sitting above the written path', () => {
        const index = new SubscriberIndex();

        index.add('container', setOf('items'));

        expect(sorted(index.match(setOf('items.a1.title')))).toEqual(['container']);
        expect(sorted(index.match(setOf('order.0')))).toEqual([]);
    });

    test('a wildcard reader is matched by everything, and a wildcard write matches everyone', () => {
        const index = new SubscriberIndex();

        index.add('everything', setOf(WILDCARD_PATH));
        index.add('narrow', setOf('a'));

        expect(sorted(index.match(setOf('whatever.path')))).toEqual(['everything']);
        expect(sorted(index.match(setOf(WILDCARD_PATH)))).toEqual(['everything', 'narrow']);
    });

    test('re-adding an id replaces its paths', () => {
        const index = new SubscriberIndex();

        index.add('reader', setOf('a'));
        index.add('reader', setOf('b'));

        expect(sorted(index.match(setOf('a')))).toEqual([]);
        expect(sorted(index.match(setOf('b')))).toEqual(['reader']);
    });

    test('removing an id drops all of its paths', () => {
        const index = new SubscriberIndex();

        index.add('reader', setOf('items.a1.title', 'order'));
        index.remove('reader');

        expect(sorted(index.match(setOf('items')))).toEqual([]);
        expect(sorted(index.match(setOf('order.0')))).toEqual([]);
        expect(sorted(index.match(setOf(WILDCARD_PATH)))).toEqual([]);
    });

    test('addPath files a new path into an existing registration', () => {
        const index = new SubscriberIndex();

        index.add('reader', setOf('items.a1.title'));
        index.addPath('reader', 'items.a2.title');

        expect(sorted(index.match(setOf('items.a1.title')))).toEqual(['reader']);
        expect(sorted(index.match(setOf('items.a2.title')))).toEqual(['reader']);
        expect(sorted(index.match(setOf('items.a2')))).toEqual(['reader']);
    });

    test('addPath is a no-op for a path already filed', () => {
        const index = new SubscriberIndex();

        index.add('reader', setOf('items.a1.title'));
        index.addPath('reader', 'items.a1.title');

        expect(sorted(index.match(setOf('items.a1.title')))).toEqual(['reader']);

        // A no-op amendment must not leave a second registration behind: one remove clears it.
        index.remove('reader');
        expect(sorted(index.match(setOf('items.a1.title')))).toEqual([]);
    });

    test('addPath still registers a path a caller already added to the shared reads set', () => {
        // The scenario Carburetor.subscribe's adopt-not-copy design has to survive: a caller
        // (a computed's own dependency.reads) may add a path to the very Set the index holds
        // before calling addPath for it — subscribe() no longer copies that Set away first.
        // Filing must be decided by the index's own state, not by Set membership, or this
        // path would look "already filed" and never reach `exact`/`branch`.
        const index = new SubscriberIndex();
        const reads = setOf('items.a1.title');

        index.add('reader', reads);
        reads.add('items.a2.title');
        index.addPath('reader', 'items.a2.title');

        expect(sorted(index.match(setOf('items.a2.title')))).toEqual(['reader']);
        expect(sorted(index.match(setOf('items.a2')))).toEqual(['reader']);
    });

    test('addPath is a no-op for an id with no registration', () => {
        const index = new SubscriberIndex();

        index.addPath('ghost', 'items.a1.title');

        expect(sorted(index.match(setOf('items.a1.title')))).toEqual([]);
    });

    test('addPath under a wildcard subscriber files the path too', () => {
        const index = new SubscriberIndex();

        index.add('everything', setOf(WILDCARD_PATH));
        index.addPath('everything', 'items.a1.title');

        expect(sorted(index.match(setOf('unrelated')))).toEqual(['everything']);
        expect(sorted(index.match(setOf('items.a1.title')))).toEqual(['everything']);
    });

    test('remove after addPath leaves no stale entries', () => {
        const index = new SubscriberIndex();

        index.add('reader', setOf('items.a1.title'));
        index.addPath('reader', 'items.a2.title');
        index.addPath('reader', 'order');
        index.remove('reader');

        expect(sorted(index.match(setOf('items.a1.title')))).toEqual([]);
        expect(sorted(index.match(setOf('items.a2.title')))).toEqual([]);
        expect(sorted(index.match(setOf('items')))).toEqual([]);
        expect(sorted(index.match(setOf('order')))).toEqual([]);
    });

    test('addPath agrees with a full scan over randomised incremental path sets', () => {
        const segments = ['items', 'order', 'a1', 'a2', 'title', 'done', 'meta'];
        let seed = 20260928;

        // Deterministic pseudo-random, so a failure is reproducible.
        const next = (bound: number): number => {
            seed = (seed * 1103515245 + 12345) % 2147483648;

            return seed % bound;
        };

        const randomPath = (): TPath => {
            const depth = 1 + next(3);
            const parts: string[] = [];

            for (let i = 0; i < depth; i++) {
                parts.push(segments[next(segments.length)]);
            }

            return parts.join('.');
        };

        for (let round = 0; round < 200; round++) {
            const index = new SubscriberIndex();
            const readsById = new Map<string, TPathSet>();

            for (let subscriber = 0; subscriber < 12; subscriber++) {
                const id = 'subscriber' + subscriber;
                const reads = new Set<TPath>();
                const count = 1 + next(4);

                // Registered empty, then built up one addPath call at a time — the same
                // amendment pattern a live computed result uses for a leaf read per render.
                index.add(id, reads);
                readsById.set(id, reads);

                for (let i = 0; i < count; i++) {
                    const path = next(10) === 0 ? WILDCARD_PATH : randomPath();

                    // addPath owns filing the path into the shared reads set — see the
                    // ownership note on Carburetor.extend for why that sharing is safe here.
                    index.addPath(id, path);
                }
            }

            const writes = new Set<TPath>();
            const writeCount = 1 + next(4);

            for (let i = 0; i < writeCount; i++) {
                writes.add(randomPath());
            }

            expect(sorted(index.match(writes))).toEqual(sorted(matchByScan(readsById, writes)));
        }
    });

    test('agrees with a full scan over randomised path sets', () => {
        const segments = ['items', 'order', 'a1', 'a2', 'title', 'done', 'meta'];
        let seed = 20260920;

        // Deterministic pseudo-random, so a failure is reproducible.
        const next = (bound: number): number => {
            seed = (seed * 1103515245 + 12345) % 2147483648;

            return seed % bound;
        };

        const randomPath = (): TPath => {
            const depth = 1 + next(3);
            const parts: string[] = [];

            for (let i = 0; i < depth; i++) {
                parts.push(segments[next(segments.length)]);
            }

            return parts.join('.');
        };

        for (let round = 0; round < 200; round++) {
            const index = new SubscriberIndex();
            const readsById = new Map<string, TPathSet>();

            for (let subscriber = 0; subscriber < 12; subscriber++) {
                const reads = new Set<TPath>();
                const count = 1 + next(3);

                for (let i = 0; i < count; i++) {
                    reads.add(next(10) === 0 ? WILDCARD_PATH : randomPath());
                }

                const id = 'subscriber' + subscriber;
                readsById.set(id, reads);
                index.add(id, reads);
            }

            const writes = new Set<TPath>();
            const writeCount = 1 + next(4);

            for (let i = 0; i < writeCount; i++) {
                writes.add(randomPath());
            }

            expect(sorted(index.match(writes))).toEqual(sorted(matchByScan(readsById, writes)));
        }
    });

    describe('diffing re-registration (R15-04)', () => {
        test('a one-path addition to a known id registers only the delta, not the whole read set', () => {
            const index = new SpyIndex();
            const base = setOf(
                'items.a1.f0', 'items.a1.f1', 'items.a1.f2', 'items.a1.f3', 'items.a1.f4',
                'items.a1.f5', 'items.a1.f6', 'items.a1.f7', 'items.a1.f8', 'items.a1.f9',
            );

            index.add('reader', base);
            index.resetCounts();

            const grown = new Set<TPath>(base);

            grown.add('items.a1.f10');
            index.add('reader', grown);

            // The new leaf files once, plus once per ancestor ('items.a1', 'items') — never
            // once per member of the ten paths that did not change.
            expect(index.registerCalls).toBe(3);
            expect(index.unregisterCalls).toBe(0);

            expect(sorted(index.match(setOf('items.a1.f10')))).toEqual(['reader']);
            expect(sorted(index.match(setOf('items.a1.f0')))).toEqual(['reader']);
        });

        test('a one-path removal from a known id unregisters only the delta', () => {
            const index = new SpyIndex();
            const base = setOf(
                'items.a1.f0', 'items.a1.f1', 'items.a1.f2', 'items.a1.f3', 'items.a1.f4',
                'items.a1.f5', 'items.a1.f6', 'items.a1.f7', 'items.a1.f8', 'items.a1.f9',
            );

            index.add('reader', base);
            index.resetCounts();

            const shrunk = new Set<TPath>(base);

            shrunk.delete('items.a1.f0');
            index.add('reader', shrunk);

            // The dropped leaf unregisters once, plus once per ancestor — the other nine
            // paths, and their now-shared ancestors, are left untouched.
            expect(index.unregisterCalls).toBe(3);
            expect(index.registerCalls).toBe(0);

            expect(sorted(index.match(setOf('items.a1.f0')))).toEqual([]);
            expect(sorted(index.match(setOf('items.a1.f1')))).toEqual(['reader']);
        });

        test('re-adding the same Set instance addPath already amended in place is a no-op', () => {
            // The scenario add() cannot tell apart by looking at `reads` alone: a computed's
            // dependency.reads is adopted by reference, addPath may already have filed a path
            // into it before something re-subscribes with that very same (now larger) object.
            // The diff must come out empty — everything in it is already filed — instead of
            // either re-filing everything or, worse, missing the already-filed path.
            const index = new SpyIndex();
            const reads = setOf('items.a1.title');

            index.add('reader', reads);
            index.addPath('reader', 'items.a2.title');
            index.resetCounts();

            index.add('reader', reads);

            expect(index.registerCalls).toBe(0);
            expect(index.unregisterCalls).toBe(0);
            expect(sorted(index.match(setOf('items.a1.title')))).toEqual(['reader']);
            expect(sorted(index.match(setOf('items.a2.title')))).toEqual(['reader']);
        });

        test('re-adding the same Set instance after a direct (non-addPath) mutation is a no-op, by design', () => {
            // R16-09: the index no longer keeps a second, owned copy of what is filed next to
            // readsById, so a re-registration diffs against readsById's own previous entry.
            // That only works while the fresh Set and the held one are distinct objects — see
            // add()'s own comment. Handing back the very instance the index already holds is
            // out of contract for anything other than addPath, which keeps exact/branch in
            // sync as it mutates that Set; a caller that mutates it some other way and hands
            // the same instance back gets a no-op instead of a silently wrong diff.
            const index = new SubscriberIndex();
            const reads = setOf('a', 'b');

            index.add('reader', reads);
            reads.delete('a');
            index.add('reader', reads);

            // Still filed under 'a': the deletion never went through a diffable re-registration.
            expect(sorted(index.match(setOf('a')))).toEqual(['reader']);
            expect(sorted(index.match(setOf('b')))).toEqual(['reader']);
        });

        test('agrees with a full scan over randomised re-add sequences, including a shared Set grown in place', () => {
            const segments = ['items', 'order', 'a1', 'a2', 'title', 'done', 'meta'];
            let seed = 20260929;

            const next = (bound: number): number => {
                seed = (seed * 1103515245 + 12345) % 2147483648;

                return seed % bound;
            };

            const randomPath = (): TPath => {
                const depth = 1 + next(3);
                const parts: string[] = [];

                for (let i = 0; i < depth; i++) {
                    parts.push(segments[next(segments.length)]);
                }

                return parts.join('.');
            };

            for (let round = 0; round < 200; round++) {
                const index = new SubscriberIndex();
                const readsById = new Map<string, TPathSet>();

                for (let subscriber = 0; subscriber < 8; subscriber++) {
                    const id = 'subscriber' + subscriber;
                    let reads = new Set<TPath>();
                    const generations = 1 + next(4);

                    index.add(id, reads);

                    for (let generation = 0; generation < generations; generation++) {
                        // Half the time, grow the very Set the index already holds through
                        // addPath — the amendment pattern a live computed dependency uses,
                        // and the one mutation of a shared, already-adopted Set the index can
                        // still diff correctly (see add()'s own comment). The other half, hand
                        // over a fresh Set — possibly shrunk — which add() diffs normally.
                        if (next(2) === 0) {
                            const additions = 1 + next(2);

                            for (let i = 0; i < additions; i++) {
                                index.addPath(id, next(10) === 0 ? WILDCARD_PATH : randomPath());
                            }
                        } else {
                            reads = new Set<TPath>(reads);

                            const additions = 1 + next(2);

                            for (let i = 0; i < additions; i++) {
                                reads.add(next(10) === 0 ? WILDCARD_PATH : randomPath());
                            }

                            if (reads.size > 1 && next(2) === 0) {
                                const asArray = Array.from(reads);

                                reads.delete(asArray[next(asArray.length)]);
                            }

                            index.add(id, reads);
                        }
                    }

                    readsById.set(id, reads);
                }

                const writes = new Set<TPath>();
                const writeCount = 1 + next(4);

                for (let i = 0; i < writeCount; i++) {
                    writes.add(randomPath());
                }

                expect(sorted(index.match(writes))).toEqual(sorted(matchByScan(readsById, writes)));
            }
        });
    });

    describe('bucket representation (R15-05)', () => {
        test('a single subscriber files a bucket as the bare id, not a one-element Set', () => {
            const index = new InspectableIndex();

            index.add('reader', setOf('items.a1.title'));

            expect(index.exactBucket('items.a1.title')).toBe('reader');
            expect(index.branchBucket('items.a1')).toBe('reader');
            expect(index.branchBucket('items')).toBe('reader');
        });

        test('a second subscriber promotes the bucket to a Set', () => {
            const index = new InspectableIndex();

            index.add('reader1', setOf('items.a1.title'));
            index.add('reader2', setOf('items.a1.title'));

            const bucket = index.exactBucket('items.a1.title');

            expect(bucket).toBeInstanceOf(Set);
            expect(Array.from(bucket as Set<string>).sort()).toEqual(['reader1', 'reader2']);
        });

        test('losing the second subscriber demotes the bucket back to a bare id', () => {
            const index = new InspectableIndex();

            index.add('reader1', setOf('items.a1.title'));
            index.add('reader2', setOf('items.a1.title'));
            index.remove('reader2');

            expect(index.exactBucket('items.a1.title')).toBe('reader1');
        });

        test('losing the only subscriber drops the bucket entirely', () => {
            const index = new InspectableIndex();

            index.add('reader', setOf('items.a1.title'));
            index.remove('reader');

            expect(index.exactBucket('items.a1.title')).toBeUndefined();
            expect(index.branchBucket('items.a1')).toBeUndefined();
        });
    });
});

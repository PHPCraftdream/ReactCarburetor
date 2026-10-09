import {S} from "@/Carburetor/Store/Diagnostics/Internal/StoreIdentity";
import {Carburetor, ISubscribeOptions} from "@/Carburetor";
import {TSubscriber} from "@/Carburetor/Models/Base";
import {TPath, TPathSet} from "@/Carburetor/Models/Paths";
import {SubscriberIndex} from "@/Carburetor/Store/Paths/SubscriberIndex";

export interface ITestData {
    a: number;
    b: number;
    nested: {
        value: number;
    };
}

export const getTestData = (): ITestData => ({a: 0, b: 0, nested: {value: 0}});

export class TestCarburetor extends Carburetor<ITestData> {
    public setA = (a: number) => {
        this.draft.a = a;

        this.emitUpdate();
    };

    public setB = (b: number) => {
        this.draft.b = b;

        this.emitUpdate();
    };

    public setNestedValue = (value: number) => {
        this.draft.nested.value = value;

        this.emitUpdate();
    };

    /** The recommended form: mutate and publish in one step. */
    public setAThroughUpdate = (a: number) => {
        this.update((draft: ITestData) => {
            draft.a = a;
        });
    };

    /** A mutation that dies after its first write has already landed. */
    public throwAfterWrite = (a: number) => {
        this.update((draft: ITestData) => {
            draft.a = a;

            throw new Error('mutate failed halfway');
        });
    };

    /** An async mutation: the write lands after update() has already published. */
    public setAThroughAsyncUpdate = (a: number) => {
        // The rule is right; this proves the runtime diagnostic catches it as well.
        // oxlint-disable-next-line carburetor/no-async-transaction
        this.update(async (draft: ITestData) => {
            await Promise.resolve();

            draft.a = a;
        });
    };

    /** Writes through draft and never publishes â€” the mistake the dev check reports. */
    public setAWithoutEmit = (a: number) => {
        // The rule is right; this method exists to prove the runtime check catches it too.
        // oxlint-disable-next-line carburetor/require-emit-after-draft-write
        this.draft.a = a;
    };

    /** A write bypassing draft: the carburetor cannot know the changed paths and must wake everyone. */
    public setAUntracked = (a: number) => {
        // oxlint-disable-next-line carburetor/no-direct-data-write
        this.data.a = a;

        this.emitUpdate();
    };

    /** A write through getData: tracked by nobody, like any escape from draft. */
    public setBThroughGetData = (b: number) => {
        // The rule is right; this write exists to prove an emit with no recorded path wakes everyone.
        // oxlint-disable-next-line carburetor/no-external-data-mutation
        this.getData().b = b;

        this.emitUpdate();
    };

    /** Mixed in one emit: a precise write through draft and a blind one through getData. */
    public setAandUntrackedB = (a: number, b: number) => {
        this.draft.a = a;

        // The rule is right; the blind write mixed into a precise emit is exactly what the test pins down.
        // oxlint-disable-next-line carburetor/no-external-data-mutation
        this.getData().b = b;

        this.emitUpdate();
    };

    /** The same mixed write, with the blind write owned deliberately through markAllChanged. */
    public setAandUntrackedBWithMark = (a: number, b: number) => {
        this.draft.a = a;

        // The rule is right; this blind write is owned deliberately through markAllChanged below.
        // oxlint-disable-next-line carburetor/no-external-data-mutation
        this.getData().b = b;

        this.markAllChanged();

        this.emitUpdate();
    };

    /** Touches draft without writing anything, then publishes: the true no-op emit path. */
    public touchDraftWithoutWrite = () => {
        void this.draft;

        this.emitUpdate();
    };

    /** The live `writes` Set, so a test can check whether an emit reallocated it. */
    public writesRef = (): TPathSet => this[S.writes];
}

export interface IItemListData {
    items: Array<{n: number}>;
}

export class ItemListCarburetor extends Carburetor<IItemListData> {
    /** Sorts items in place: an already ordered list must wake nobody. */
    public sortItems = () => {
        this.update((draft: IItemListData) => {
            draft.items.sort((x, y) => x.n - y.n);
        });
    };

    /** Writes every element back as it was read: the data must keep its raw objects. */
    public selfReassign = () => {
        this.update((draft: IItemListData) => {
            draft.items.forEach((item, index) => {
                draft.items[index] = item;
            });
        });
    };

    /** Replaces one element with a genuinely different object. */
    public replaceFirst = (item: {n: number}) => {
        this.update((draft: IItemListData) => {
            draft.items[0] = item;
        });
    };
}

export const readsOf = (...paths: TPath[]): TPathSet => new Set<TPath>(paths);

/** Exposes `readsById` by id, so a test can compare the index's stored Set by identity (R6-04). */
class InspectableIndex extends SubscriberIndex {
    public readsFor(id: string) {
        return this.readsById.get(id);
    }
}

/**
 * A carburetor whose index is inspectable, so a test can tell whether `subscribe()` copied
 * `reads` or adopted it by reference (R6-04).
 */
export class InspectableCarburetor extends TestCarburetor {
    public override [S.subscriberIndex]: InspectableIndex = new InspectableIndex();

    /** The Set the index actually holds for one subscriber id, or undefined if it holds none. */
    public readsFor(id: string) {
        return this[S.subscriberIndex].readsFor(id);
    }
}

/**
 * Overrides `subscribe()` to swap `options.reads` for a copy before delegating — a subclass
 * that does not forward the exact Set (or brand) it was given (R6-04).
 */
export class SwappingCarburetor extends InspectableCarburetor {
    /** The Set actually forwarded to `super.subscribe()` by the last call, for identity checks. */
    public swappedReads?: TPathSet;

    public override subscribe(callback: TSubscriber, options: ISubscribeOptions = {}): string {
        this.swappedReads = options.reads === undefined ? undefined : new Set(options.reads);

        return super.subscribe(callback, {...options, reads: this.swappedReads});
    }
}

/**
 * A `ReadonlySet<string>` that is not a real `Set` — the shape `subscribe(callback, {reads})`
 * accepts on the public contract, and the one a caller's own read-set implementation might
 * actually hand over (R6-04).
 */
export class FakeReadonlySet implements ReadonlySet<string> {
    public constructor(private readonly items: readonly string[]) {
    }

    public get size(): number {
        return this.items.length;
    }

    public has(value: string): boolean {
        return this.items.includes(value);
    }

    public forEach(callback: (value: string, key: string, set: ReadonlySet<string>) => void): void {
        this.items.forEach((item: string) => callback(item, item, this));
    }

    public keys(): IterableIterator<string> {
        return this.items[Symbol.iterator]();
    }

    public values(): IterableIterator<string> {
        return this.keys();
    }

    public entries(): IterableIterator<[string, string]> {
        return this.items.map((item: string): [string, string] => [item, item])[Symbol.iterator]();
    }

    public [Symbol.iterator](): IterableIterator<string> {
        return this.keys();
    }
}

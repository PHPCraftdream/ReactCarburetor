import {Carburetor, TPath, TPathSet} from "@/Carburetor";

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

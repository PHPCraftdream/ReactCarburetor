// #region doc
import {bind, Carburetor, waitForUpdate} from '@react-carburetor/core';

const fetchCount = async (): Promise<number> => 1;

class CountCarburetor extends Carburetor<{value: number}> {
    @bind
    public async reload(): Promise<void> {
        const value = await fetchCount();
        this.draft.value = value;
        this.emitUpdate();
    }
}

export async function testReload(): Promise<void> {
    const store = new CountCarburetor({value: 0});
    const updated = waitForUpdate(store);

    void store.reload();
    await updated;

    if (store.getData().value !== 1) {
        throw new Error('reload did not apply the fetched count');
    }
}
// #endregion doc

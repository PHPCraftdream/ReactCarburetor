import {bind, Carburetor, waitForUpdate} from '@react-carburetor/core';
import {fetchUser} from '../resources/endpoints/user';

interface User {
    name: string;
}

// #region doc
class UserCarburetor extends Carburetor<{user: User | undefined; loading: boolean}> {
    @bind
    public async load(id: string): Promise<void> {
        this.draft.loading = true;
        this.emitUpdate();
        const user = await fetchUser(id);
        try {
            this.draft.user = user;
            this.draft.loading = false;
        } finally {
            this.emitUpdate();
        }
    }
}

export const store = new UserCarburetor({user: undefined, loading: false});

const run = async (): Promise<void> => {
    const updated = waitForUpdate(store, 2000);
    void store.load('u1');
    await updated;
    console.log(store.getData().loading); // true — the first update (loading = true) arrived
};
// #endregion doc
void run;

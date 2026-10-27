// #region session
import {Carburetor, getInitialResourceData, IResourceData} from '@react-carburetor/core';

interface Session {
    token: string;
}

class SessionStore extends Carburetor<{current: IResourceData<Session>}> {
    public constructor() {
        super({current: getInitialResourceData<Session>()});
    }

    public reset(): void {
        this.draft.current = getInitialResourceData<Session>();
        this.emitUpdate();
    }
}
// #endregion session
void SessionStore;

// #region scheduler
import {Carburetor, IUpdateScheduler, TUpdater} from 'react-carburetor';

/** Delivers every update on the next macrotask instead of synchronously. */
class NextTickScheduler implements IUpdateScheduler {
    private readonly timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

    public schedule(uid: string, updater: TUpdater): void {
        this.cancel(uid);
        this.timers.set(uid, setTimeout(updater, 0));
    }

    public cancel(uid: string): void {
        const timer = this.timers.get(uid);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.timers.delete(uid);
        }
    }
}

const store = new Carburetor({tick: 0}, new NextTickScheduler());
store.setData({tick: 1});
// #endregion scheduler

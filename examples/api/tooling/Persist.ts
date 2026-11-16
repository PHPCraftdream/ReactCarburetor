// #region doc
import {bind, Carburetor, IPersistOptions, IStorageLike, persist} from '@react-carburetor/core';

class TodoCarburetor extends Carburetor<{items: string[]}> {
    @bind
    public add(item: string): void {
        this.draft.items.push(item);
        this.emitUpdate();
    }
}

const logPersistError = (error: unknown): void => { console.error('persist failed', error); };

const memoryStorage = (): IStorageLike => {
    const items = new Map<string, string>();
    return {
        getItem: (key: string): string | null => items.get(key) ?? null,
        setItem: (key: string, value: string): void => { items.set(key, value); },
        removeItem: (key: string): void => { items.delete(key); },
    };
};

const store = new TodoCarburetor({items: []});
const options: IPersistOptions<{items: string[]}> = {
    key: 'todos',
    storage: memoryStorage(),
    coalesce: false,
    onError: logPersistError,
};
const stop = persist(store, options);

store.add('first');
stop();
// #endregion doc

// #region flush
// A throttled write is held back for up to throttleMs. Closing the tab inside that window
// would lose it, so write it when the page is hidden or left.
const persistDraft = (draft: Carburetor<{text: string}>): (() => void) => {
    const stopPersist = persist(draft, {key: 'draft', storage: localStorage, throttleMs: 1000});
    const flushWhenHidden = (): void => {
        if (document.visibilityState === 'hidden') stopPersist.flush();
    };
    document.addEventListener('visibilitychange', flushWhenHidden);
    window.addEventListener('pagehide', stopPersist.flush);
    return (): void => {
        document.removeEventListener('visibilitychange', flushWhenHidden);
        window.removeEventListener('pagehide', stopPersist.flush);
        stopPersist();
    };
};
// #endregion flush
void persistDraft;

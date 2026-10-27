import {Carburetor, IStorageLike, persist} from '@react-carburetor/core';

interface IProfile {
    name: string;
    skills: Record<string, number>;
}

const storage: IStorageLike = {
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: key => localStorage.removeItem(key),
};

// v1 renamed `nick` to `name`; v2 added `skills`, which the current defaults fill in.
const renameNick = (state: unknown): unknown => {
    const {nick, ...rest} = state as {nick?: string};
    return {...rest, name: nick ?? ''};
};
const keepAsIs = (state: unknown): unknown => state;

const profile = new Carburetor<IProfile>({name: '', skills: {letters: 0, numbers: 0}});
const stop = persist(profile, {
    key: 'app.profile',
    storage,
    version: 2,
    migrate: {1: renameNick, 2: keepAsIs},
    // Drops keys the current shape no longer has, such as a retired `logic` field.
    prune: true,
});

stop();

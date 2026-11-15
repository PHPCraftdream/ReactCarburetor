import {writableEntry} from '@/Carburetor/Resource/Cache/State/Mutation/writableEntry';

interface IEntry {n: number}

describe('writableEntry', () => {
    test('while the root still holds the entry, every call answers the view resolved up front', () => {
        const entry: IEntry = {n: 1};
        const view: IEntry = {n: 1};
        const current = writableEntry({entries: {k: entry}}, {entries: {k: view}}, 'k', entry);

        expect(current()).toBe(view);
        expect(current()).toBe(view);
    });

    test('once the root holds another entry under the key, the draft is resolved again', () => {
        const entry: IEntry = {n: 1};
        const view: IEntry = {n: 1};
        const root = {entries: {k: entry} as Record<string, IEntry>};
        const draft = {entries: {k: view} as Record<string, IEntry>};
        const current = writableEntry(root, draft, 'k', entry);

        const replacement: IEntry = {n: 2};

        root.entries.k = replacement;
        draft.entries.k = replacement;

        expect(current()).toBe(replacement);
        expect(current()).not.toBe(view);
    });

    test('an entry removed from the root answers whatever the draft holds now', () => {
        const entry: IEntry = {n: 1};
        const root = {entries: {k: entry} as Record<string, IEntry>};
        const draft = {entries: {k: entry} as Record<string, IEntry>};
        const current = writableEntry(root, draft, 'k', entry);

        delete root.entries.k;
        delete draft.entries.k;

        expect(current()).toBeUndefined();
    });

    test('the view is taken from the draft once, when the resolver is made', () => {
        const entry: IEntry = {n: 1};
        const view: IEntry = {n: 1};
        const draft = {entries: {k: view} as Record<string, IEntry>};
        const current = writableEntry({entries: {k: entry}}, draft, 'k', entry);

        draft.entries.k = {n: 99};

        expect(current()).toBe(view);
    });
});

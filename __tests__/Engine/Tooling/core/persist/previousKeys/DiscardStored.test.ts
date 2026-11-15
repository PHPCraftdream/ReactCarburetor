import {IStorageLike, diagnostics} from '@/Carburetor';
import {discardStored} from '@/Carburetor/Tooling/Persist/DiscardStored';

const storageOf = (log: string[], failRemoval?: Error): IStorageLike => ({
    getItem: () => null,
    setItem: () => undefined,
    removeItem: key => {
        log.push('remove:' + key);

        if (failRemoval) throw failRemoval;
    },
});

describe('discardStored', () => {
    test('reports the failure first, then removes the entry', () => {
        const log: string[] = [];

        discardStored(
            storageOf(log), 'app', new Error('bad entry'), error => log.push('report:' + (error as Error).message),
        );

        expect(log).toEqual(['report:bad entry', 'remove:app']);
    });

    test('a removal that throws is reported to the same handler after the first failure', () => {
        const log: string[] = [];

        discardStored(
            storageOf(log, new Error('storage locked')), 'app', new Error('bad entry'),
            error => log.push('report:' + (error as Error).message),
        );

        expect(log).toEqual(['report:bad entry', 'remove:app', 'report:storage locked']);
    });

    test('without a handler a removal that throws is rethrown', () => {
        const log: string[] = [];

        diagnostics.setEnabled(false);

        try {
            expect(() => discardStored(
                storageOf(log, new Error('storage locked')), 'app', new Error('bad entry'), undefined,
            )).toThrow('storage locked');
        } finally {
            diagnostics.setEnabled(true);
        }

        expect(log).toEqual(['remove:app']);
    });
});

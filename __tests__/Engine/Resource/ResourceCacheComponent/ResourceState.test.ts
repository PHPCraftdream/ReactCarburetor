import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
import {resourceState} from '@/Carburetor/Resource/Status/resourceState';

describe('resourceState', () => {
    it('Idle without data is loading', () => {
        const state = resourceState(EResourceStatus.Idle);
        expect(state.isIdle).toBe(true);
        expect(state.isLoading).toBe(true);
        expect(state.refreshFailed).toBe(false);
    });

    it('Idle with kept data after an abort is not loading', () => {
        const state = resourceState(EResourceStatus.Idle, 'kept');
        expect(state.isLoading).toBe(false);
    });

    it('Pending without data is loading; with data it is not', () => {
        expect(resourceState(EResourceStatus.Pending).isLoading).toBe(true);
        expect(resourceState(EResourceStatus.Pending, 'stale').isLoading).toBe(false);
    });

    it('Success without error is clean', () => {
        const state = resourceState(EResourceStatus.Success, 'data');
        expect(state.isSuccess).toBe(true);
        expect(state.isLoading).toBe(false);
        expect(state.refreshFailed).toBe(false);
    });

    it('Success with an error marks refreshFailed, not loading', () => {
        const state = resourceState(EResourceStatus.Success, 'data', 'boom');
        expect(state.refreshFailed).toBe(true);
        expect(state.isLoading).toBe(false);
    });

    it('Error is an error, never refreshFailed', () => {
        const state = resourceState(EResourceStatus.Error, undefined, 'boom');
        expect(state.isError).toBe(true);
        expect(state.isLoading).toBe(false);
        expect(state.refreshFailed).toBe(false);
    });
});

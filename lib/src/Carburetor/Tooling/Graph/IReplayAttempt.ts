/** State retained by one undo/redo call and its exact replay publication owner. */
export interface IReplayAttempt {
    owner: object;
    started: boolean;
    refused: boolean;
    reconcile: (() => void) | undefined;
}

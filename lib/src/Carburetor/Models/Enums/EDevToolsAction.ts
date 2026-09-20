/** Time travel actions the DevTools panel dispatches back to the app. */
export enum EDevToolsAction {
    JumpToAction = 'JUMP_TO_ACTION',
    JumpToState = 'JUMP_TO_STATE',
    Rollback = 'ROLLBACK',
}

import {Carburetor, transaction} from 'react-carburetor';
import type {TReadonly} from 'react-carburetor';

export interface IRound {
    round: {kind: string; wrong: number[]; locked: boolean};
}

// #region module-mutators
const mutators = {
    /**
     * Locks the round after a winning answer.
     *
     * @param draft - state to change
     */
    lockWin(draft: IRound): void {
        draft.round.locked = true;
    },
    /**
     * Marks an answer wrong at its position.
     *
     * @param draft - state to change
     * @param index - position to mark
     */
    markWrong(draft: IRound, index: number): void {
        draft.round.wrong[index] = 1;
    },
};
// #endregion module-mutators

export class RoundStore extends Carburetor<IRound> {
    // #region store-methods
    /** Marks an answer wrong.
     *
     * @param index - position to mark
     */
    public markWrong(index: number): void {
        this.update(mutators.markWrong, index);
    }

    public lockWin(): void {
        this.update(mutators.lockWin);
    }

    // #region finish-round
    public finishRound(): void {
        transaction(() => {
            this.update(mutators.markWrong, 0);
            this.update(mutators.lockWin);
        });
    }
    // #endregion finish-round
    // #endregion store-methods
}

/** Counts marked answers from a readonly state view.
 *
 * @param state - readonly round data
 */
export const countWrong = (state: TReadonly<IRound>): number =>
    state.round.wrong.filter(Boolean).length;

// #region readonly-array-helper
/** Returns how many round kinds are available.
 *
 * @param kinds - accepted round kinds
 */
export const countKinds = (kinds: readonly string[]): number => kinds.length;
// #endregion readonly-array-helper

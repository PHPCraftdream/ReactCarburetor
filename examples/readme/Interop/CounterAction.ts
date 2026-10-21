// #region counter
import {Carburetor, action} from '@/Carburetor';

export class Counter extends Carburetor<{value: number}> {
    constructor() { super({value: 0}); }

    /** Increments the counter twice in one published action. */
    @action addTwice(): void {
        this.draft.value++;
        this.draft.value++;
    }
}
// #endregion counter

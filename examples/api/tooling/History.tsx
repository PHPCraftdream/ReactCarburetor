// #region doc
import {AntiHookComponent, bind, Carburetor, CarburetorHistory, IHistoryOptions} from '@react-carburetor/core';
import {ReactElement} from 'react';

const increment = (draft: {count: number}): void => { draft.count += 1; };
const decrement = (draft: {count: number}): void => { draft.count -= 1; };

class CounterCarburetor extends Carburetor<{count: number}> {
    @bind public increment(): void { this.update(increment); }
    @bind public decrement(): void { this.update(decrement); }
}

const store = new CounterCarburetor({count: 0});
const historyOptions: IHistoryOptions = {limit: 20};
const history = new CarburetorHistory(store, historyOptions);

export class CounterView extends AntiHookComponent {
    @bind
    private undo(): void {
        history.undo();
    }

    @bind
    private redo(): void {
        history.redo();
    }

    render(): ReactElement {
        const view = this.useCarburetor(store);
        return (
            <div>
                <span>count: {view.count}</span>
                <button type="button" onClick={this.undo} disabled={!history.canUndo()}>Undo</button>
                <button type="button" onClick={this.redo} disabled={!history.canRedo()}>Redo</button>
            </div>
        );
    }
}
// #endregion doc

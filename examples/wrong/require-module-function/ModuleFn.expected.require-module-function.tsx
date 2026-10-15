import {Carburetor} from 'react-carburetor';

interface Item {done: boolean}

// #region doc
class Counter extends Carburetor<{count: number; items: Item[]}> {
    public increment(): void {
        this.update((draft) => {
            draft.count += 1;
        });
    }

    public completed() {
        return this.items.filter((item) => item.done);
    }
}

function completed(items: Item[]) {
    return items.filter((item) => item.done);
}
// #endregion doc

void Counter;
void completed;

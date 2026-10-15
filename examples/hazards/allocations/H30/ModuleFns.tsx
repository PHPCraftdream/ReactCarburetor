import {Carburetor} from 'react-carburetor';

interface Item {done: boolean}

declare const items: Item[];

// #region doc
const increment = (draft: {count: number}): void => {
    draft.count += 1;
};

const isDone = (item: Item): boolean => item.done;

class Counter extends Carburetor<{count: number}> {
    public increment(): void {
        this.update(increment);
    }

    public completed() {
        return items.filter(isDone);
    }
}

function completed(items: Item[]) {
    return items.filter(isDone);
}
// #endregion doc

void Counter;
void completed;

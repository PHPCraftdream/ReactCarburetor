import {AntiHookComponent, Carburetor, computed} from '@react-carburetor/core';

interface ITodoItem {done: boolean}

const todoCarburetor = new Carburetor<{items: Record<string, ITodoItem>}>({items: {}});

// #region activeCount
const isNotDone = (item: {done: boolean}): boolean => !item.done;

export const activeCount = computed<number>((read) => {
    const {items} = read(todoCarburetor);
    return Object.values(items).filter(isNotDone).length;
});
// #endregion activeCount

class ActiveCountLabel extends AntiHookComponent {
    // #region useComputed
    render() {
        return <span>{this.useComputed(activeCount)}</span>;
    }
    // #endregion useComputed
}

void ActiveCountLabel;

import {Carburetor, computed, shallowEqual} from '@react-carburetor/core';

interface ITodoItem {done: boolean}

const todoCarburetor = new Carburetor<{orderIds: string[]; items: Record<string, ITodoItem>}>(
    {orderIds: [], items: {}}
);

// #region visibleIds
export const visibleIds = computed<string[]>((read) => {
    const {orderIds, items} = read(todoCarburetor);
    return orderIds.filter((id) => !items[id].done);
}, {equals: shallowEqual});
// #endregion visibleIds

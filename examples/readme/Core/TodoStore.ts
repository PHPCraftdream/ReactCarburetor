import {AntiHookComponent, Carburetor} from 'react-carburetor';

interface ITodoItem {title: string; done: boolean}
interface ITodoList {orderIds: string[]; activeCount: number; items: Record<string, ITodoItem>}

const todoCarburetor = new Carburetor<ITodoList>({orderIds: [], activeCount: 0, items: {}});

// #region renameTodo
const renameTodoItem = (draft: ITodoList, id: string, title: string): void => {
    draft.items[id].title = title;   // records the changed path: items.<id>.title
};

export class TodoCarburetor extends Carburetor<ITodoList> {
    public renameTodo(id: string, title: string): void {
        this.update(renameTodoItem, id, title);   // publishes it to the readers of that path
    }
}
// #endregion renameTodo

class Reads extends AntiHookComponent {
    public render(): null {
        // #region read
        const {orderIds, activeCount} = this.useCarburetor(todoCarburetor);
        // #endregion read
        void orderIds;
        void activeCount;

        return null;
    }
}

void Reads;

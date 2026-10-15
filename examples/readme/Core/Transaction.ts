import {Carburetor, transaction} from 'react-carburetor';

class TodoStore extends Carburetor<{count: number}> {
    public createTodo(): void {}
}

class FilterStore extends Carburetor<{query: string}> {
    public reset(): void {}
}

const todoCarburetor = new TodoStore({count: 0});
const filterCarburetor = new FilterStore({query: ''});

// #region transaction
transaction(() => {
    todoCarburetor.createTodo();
    filterCarburetor.reset();
});
// #endregion transaction

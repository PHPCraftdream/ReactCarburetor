import {AntiHookComponent, ResourceCarburetor, TResourceLoader, bind} from '@react-carburetor/core';

interface TTodo {id: string}

declare function fetchTodo(id: string, signal: AbortSignal): Promise<TTodo>;

const loadTodo: TResourceLoader<TTodo, [{id: string}]> =
    async ({id}, signal) => fetchTodo(id, signal);

// #region doc
class TodoResource extends ResourceCarburetor<TTodo, [{id: string}]> {
    constructor() {
        super(loadTodo);
    }
}

const todoResource = new TodoResource();

class TodoList extends AntiHookComponent<{id: string}> {
    @bind
    private stopLoading(): void {
        todoResource.abort();
    }

    protected useEffects(): void {
        this.useEffect('load', () => {
            void todoResource.load({id: this.props.id});
            return this.stopLoading;
        }, [this.props.id]);
    }
}
// #endregion doc

void TodoList;

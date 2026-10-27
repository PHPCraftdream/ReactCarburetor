import {AntiHookComponent, ResourceCarburetor} from '@react-carburetor/core';

interface ITodo {id: string}

declare function fetchTodo(id: string, signal: AbortSignal): Promise<ITodo>;

class TodoResource extends ResourceCarburetor<ITodo, [{id: string}]> {
    constructor() {
        const fetchWithSignal = fetchTodo;
        super(async ({id}, signal) => fetchWithSignal(id, signal));
    }
}

const todoResource = new TodoResource();

export class WrongLoad extends AntiHookComponent<{id: string}> {
    // #region doc
    protected useEffects(): void {
        this.useEffect('load', async () => {
            await todoResource.load();
        }, []);
    }
    // #endregion doc

    public render() {
        return null;
    }
}

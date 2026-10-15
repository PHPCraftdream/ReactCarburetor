import {AntiHookComponent, Carburetor} from 'react-carburetor';

class Todos extends Carburetor<{items: Record<string, {done: boolean}>}> {}

const todoCarburetor = new Todos({items: {a: {done: false}}});

export class WrongMutation extends AntiHookComponent {
    public render() {
        // #region doc
        const data = this.useCarburetor(todoCarburetor);

        (data.items as Record<string, {done: boolean}>).a.done = true;
        // #endregion doc

        return <span>{data.items.a.done}</span>;
    }
}

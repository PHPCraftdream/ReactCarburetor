import {AntiHookComponent, Carburetor} from 'react-carburetor';

const todoCarburetor = new Carburetor({count: 0});

export class Counter extends AntiHookComponent {
    public render() {
        // #region doc
        const {count} = this.useCarburetor(todoCarburetor);
        // #endregion doc

        return <span>{count}</span>;
    }
}

import {AntiHookComponent, Carburetor, computed} from 'react-carburetor';

const store = new Carburetor({visible: 3});
const visibleCount = computed(read => read(store).visible);

export class Counter extends AntiHookComponent {
    public render() {
        // #region doc
        const count = this.useComputed(visibleCount);
        // #endregion doc

        return <span>{count}</span>;
    }
}

import {AntiHookComponent, Carburetor, computed} from 'react-carburetor';

const store = new Carburetor({visible: 3});
const visibleCount = computed(read => read(store).visible);

export class WrongVisible extends AntiHookComponent {
    public render() {
        // #region doc
        return <span>{visibleCount.get()}</span>;
        // #endregion doc
    }
}

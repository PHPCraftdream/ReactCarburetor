import {AntiHookComponent, Carburetor} from 'react-carburetor';

const store = new Carburetor({count: 0});

export class WrongCounter extends AntiHookComponent {
    public render() {
        const {count} = store.getData();
        return <span>{count}</span>;
    }
}

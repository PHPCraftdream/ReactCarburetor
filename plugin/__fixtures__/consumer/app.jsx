import {AntiHookComponent} from "react-carburetor";
import {store} from "../sources";

export class Row extends AntiHookComponent {
    // no-lifecycle-class-property
    componentDidUpdate = () => {
        this.sync();
    };

    // require-super-in-lifecycle
    componentDidMount() {
        this.sync();
    }

    sync() {
        store.getData();
    }

    render() {
        // no-get-data-in-render
        return <span>{store.getData().title}</span>;
    }
}

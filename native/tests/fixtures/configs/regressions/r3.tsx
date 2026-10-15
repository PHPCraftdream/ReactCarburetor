import {AntiHookComponent} from "react-carburetor";

class View extends AntiHookComponent {
    public render() {
        return <Child onClick={() => console.log(1)} />;
    }
}

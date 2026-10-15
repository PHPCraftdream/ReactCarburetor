import {AntiHookComponent} from "react-carburetor";

/** Fixture for the overlap tests: linted by a test, not by `npm run lint`. */
export class OverlapRow extends AntiHookComponent {
    handle() {
        this.pick();
    }

    pick() {
        void 0;
    }

    render() {
        // The arrow is rebuilt every render: H29 here, and H31 underneath it.
        return <button onClick={() => this.handle()}>go</button>;
    }
}

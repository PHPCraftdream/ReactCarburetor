import {MyBase} from "my-app-base";

/**
 * Fixture for the custom-base test: MyBase is imported, so same-file heritage stops here, and
 * the class is recognised only when a config lists it. Linted by tests, not by npm run lint.
 */
export class Screen extends MyBase {
    // require-super-in-lifecycle
    public componentDidMount(): void {
        this.sync();
    }

    private sync(): void {}
}

import {AntiHookComponent} from "react-carburetor";

/** Fixture for the end-to-end host check: this file is linted by a test, not by `npm run lint`. */
export class BadRow extends AntiHookComponent {
    public componentDidMount = (): void => {
        // A class property shadows the base method, so subscriptions are never committed.
    };

    public render(): null {
        return null;
    }
}

export class GoodRow extends AntiHookComponent {
    public componentDidMount(): void {
        super.componentDidMount();
    }

    public render(): null {
        return null;
    }
}

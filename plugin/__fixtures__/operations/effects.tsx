import {AntiHookComponent} from "react-carburetor";
import {resource} from "./sources";

/**
 * Fixture for the end-to-end host check: every rule in the effects group must fire exactly once
 * here. This file is linted by a test, not by `npm run lint`.
 */
export class Row extends AntiHookComponent<{url: string; interval: number}> {
    protected useEffects(): void {
        // no-async-effect
        this.useEffect('load', async () => {
            await resource.load();
        }, []);

        // require-effect-deps
        this.useEffect('connect', () => connect(this.props.url), []);

        this.useEffect('timer', () => startTimer(this.props.interval), [this.props.interval]);

        // no-duplicate-effect-name
        this.useEffect('timer', () => stopTimer(), []);
    }

    public render() {
        return <span>{this.props.url}</span>;
    }
}

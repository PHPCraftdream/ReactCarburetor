import {IS_DEVELOPMENT} from "../Utils/DevelopmentFlag";

/**
 * Development-only complaints about misuse — a write that was never published, a
 * transaction handed an async body. They are on in development and off in production, and
 * can be switched explicitly: tests that assert on a mistake want them on, a noisy dev
 * session may want them off.
 *
 * Call sites also wrap the call in `if (IS_DEVELOPMENT)` so a production bundle drops the
 * message strings entirely rather than merely skipping the call.
 */
export class Diagnostics {
    protected enabled: boolean = IS_DEVELOPMENT;

    public isEnabled = (): boolean => {
        return this.enabled;
    };

    public setEnabled = (enabled: boolean): void => {
        this.enabled = enabled;
    };

    public report = (message: string): void => {
        if (!this.enabled) {
            return;
        }

        // eslint-disable-next-line no-console
        console.error('Carburetor: ' + message);
    };
}

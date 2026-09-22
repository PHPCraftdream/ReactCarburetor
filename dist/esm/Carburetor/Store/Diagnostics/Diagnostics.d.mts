/**
 * Development-only complaints about misuse — a write that was never published, a
 * transaction handed an async body. They are on in development and off in production, and
 * can be switched explicitly: tests that assert on a mistake want them on, a noisy dev
 * session may want them off.
 *
 * Call sites also wrap the call in `if (IS_DEVELOPMENT)` so a production bundle drops the
 * message strings entirely rather than merely skipping the call.
 */
export declare class Diagnostics {
    /** The switch setEnabled() flips; on by default in development, off in production. */
    protected enabled: boolean;
    /** Whether complaints are currently reported. */
    isEnabled: () => boolean;
    /** Turns complaints on or off, for a test that asserts one or a session tired of them. */
    setEnabled: (enabled: boolean) => void;
    /** Reports one complaint, prefixed so its source is obvious in a console. */
    report: (message: string) => void;
}

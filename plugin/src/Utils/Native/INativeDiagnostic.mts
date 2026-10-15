/** One problem the native binary reported, exactly as its `--format=json` prints it. */
export interface INativeDiagnostic {
    file: string;
    line: number;
    column: number;
    rule: string;
    message: string;
    severity: 'error' | 'warn' | 'off';
    /** Only `require-module-function` sets this: which of its two passes found the problem. */
    scope?: 'class' | 'module';
}

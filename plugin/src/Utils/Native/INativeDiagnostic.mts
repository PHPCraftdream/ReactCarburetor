/** One problem the native binary reported, exactly as its `--format=json` prints it. */
export interface INativeDiagnostic {
    file: string;
    line: number;
    column: number;
    rule: string;
    message: string;
    severity: 'error' | 'warn' | 'off';
}

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
    /**
     * The suggested fix as native serialized it: byte offsets into the file's UTF-8 bytes and
     * the replacement text. Only rules with a fix produce this; convert the offsets with
     * `utf16FromByte` before handing them to a host fixer, which indexes the string, not bytes.
     */
    fix?: {start: number; end: number; text: string};
}

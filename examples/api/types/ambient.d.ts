// Lint tooling ships no in-repo types for the parser the ESLint config examples import.
declare module '@typescript-eslint/parser' {
    const parser: unknown;
    export default parser;
}

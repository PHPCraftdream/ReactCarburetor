/**
 * Compile-time contract test for R16-10(1): `TAliasLedger`, the shape of the development-only
 * alias ledger, must not be part of the public package surface — only the engine's own
 * `Models/Paths` module still exports it, for `AliasLedger.ts`/the tracking proxies to import.
 *
 * Checked by `tsc --noEmit -p tsconfig.types.json`, which `npm run typecheck` runs as a fourth
 * pass — the main tsconfigs exclude test files by name, and rstest's SWC transform strips types
 * without checking them, so tsc is the only real checker here. An unsatisfied `@ts-expect-error`
 * is itself a compile error (TS2578), so if `TAliasLedger` ever leaked back into the public
 * barrel this directive would stop being satisfied and the run would fail.
 */

// @ts-expect-error TAliasLedger is a development-only ledger shape, not part of the public API
import type {TAliasLedger} from "@/Carburetor";

// Read once so the import counts as used: the compile error the directive above expects is on
// the import line itself, not here.
type TUnusedAliasLedgerReference = TAliasLedger;
void (0 as unknown as TUnusedAliasLedgerReference);

describe('public API type surface', () => {
    test('placeholder so this file is a runtime-valid test module too', () => {
        // rstest also runs this file (SWC strips the import's types without checking them), so
        // it needs at least one runtime assertion; the real check is the compile-time one above.
        expect(true).toBe(true);
    });
});

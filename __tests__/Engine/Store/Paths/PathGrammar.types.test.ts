/**
 * Compile-time contract test for R16-10(1): `TPath`, `TPathSet`, `TPathRecorder` and
 * `WILDCARD_PATH` describe the engine's internal path grammar — the `.` separator, the `~0`/`~1`
 * escapes, the `~p`/`~k` markers — which has already changed shape once (R16-01) and is not a
 * stable, user-facing format. They stay internal to `Models/Paths`/`Store/Paths/WildcardPath`;
 * `subscribe(callback, {reads})` and `read(record)` are the documented extension contract
 * instead, typed with plain `string`/`ReadonlySet<string>` so a caller never needs to name them.
 *
 * Checked by `tsc --noEmit -p tsconfig.types.json`, which `npm run typecheck` runs as a fourth
 * pass — the main tsconfigs exclude test files by name, and rstest's SWC transform strips types
 * without checking them, so tsc is the only real checker here. An unsatisfied `@ts-expect-error`
 * is itself a compile error (TS2578), so if any of these ever leaked back into the public
 * barrel one of these directives would stop being satisfied and the run would fail.
 */

// @ts-expect-error TPath is the engine's internal path-string alias, not part of the public API
import type {TPath} from "@/Carburetor";
// @ts-expect-error TPathSet is the engine's internal read-set alias, not part of the public API
import type {TPathSet} from "@/Carburetor";
// @ts-expect-error TPathRecorder is the engine's internal recorder alias, not part of the public API
import type {TPathRecorder} from "@/Carburetor";
// @ts-expect-error WILDCARD_PATH is the engine's internal "every write" marker, not public. A
// type-only import, so nothing is actually imported at runtime: rstest also executes this file,
// and a real (value) import of a member the barrel does not export would fail to load rather
// than merely fail to type-check.
import type {WILDCARD_PATH} from "@/Carburetor";

// Read once each, separately rather than unioned: the compile error the directives above expect
// is on the import line itself, and once each import fails, its name resolves to an error type
// that a union would flag as redundant against the others.
type TUnusedPath = TPath;
type TUnusedPathSet = TPathSet;
type TUnusedPathRecorder = TPathRecorder;
type TUnusedWildcardPath = typeof WILDCARD_PATH;
void (0 as unknown as TUnusedPath);
void (0 as unknown as TUnusedPathSet);
void (0 as unknown as TUnusedPathRecorder);
void (0 as unknown as TUnusedWildcardPath);

describe('public API path grammar type surface', () => {
    test('placeholder so this file is a runtime-valid test module too', () => {
        // rstest also runs this file (SWC strips the import's types without checking them), so
        // it needs at least one runtime assertion; the real check is the compile-time one above.
        expect(true).toBe(true);
    });
});
